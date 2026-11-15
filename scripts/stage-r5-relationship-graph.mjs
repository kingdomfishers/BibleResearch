/**
 * scripts/stage-r5-relationship-graph.mjs
 *
 * Packages the verified R3 grammatical relationship graph from `.artifacts/relationships-v2/`
 * into immutable, versioned Cloudflare Static Assets under `.artifacts/static-corpus/v2/relationships/`.
 *
 * Does NOT touch `.artifacts/static-corpus/manifest.json` or any of the 1,890 core corpus assets.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const R3_DIR = path.resolve('.artifacts/relationships-v2');
const STATIC_CORPUS_DIR = path.resolve('.artifacts/static-corpus');
const TABLES_DIR = path.join(STATIC_CORPUS_DIR, 'tables');
const CHAPTERS_DIR = path.join(STATIC_CORPUS_DIR, 'v1/chapters');
const REL_V2_ROOT = path.join(STATIC_CORPUS_DIR, 'v2/relationships');
const RELEASE_VERSION = 'r3-v1.2';
const RELEASE_DIR = path.join(REL_V2_ROOT, RELEASE_VERSION);

const SOURCE_GIT_COMMIT = 'b6132f8';

const BOOK_NUM_BY_USFM = {
  GEN: 1, EXO: 2, LEV: 3, NUM: 4, DEU: 5, JOS: 6, JDG: 7, RUT: 8, '1SA': 9, '2SA': 10,
  '1KI': 11, '2KI': 12, '1CH': 13, '2CH': 14, EZR: 15, NEH: 16, EST: 17, JOB: 18, PSA: 19,
  PRO: 20, ECC: 21, SNG: 22, ISA: 23, JER: 24, LAM: 25, EZK: 26, DAN: 27, HOS: 28, JOL: 29,
  AMO: 30, OBA: 31, JON: 32, MIC: 33, NAM: 34, HAB: 35, ZEP: 36, HAG: 37, ZEC: 38, MAL: 39,
  MAT: 40, MRK: 41, LUK: 42, JHN: 43, ACT: 44, ROM: 45, '1CO': 46, '2CO': 47, GAL: 48,
  EPH: 49, PHP: 50, COL: 51, '1TH': 52, '2TH': 53, '1TI': 54, '2TI': 55, TIT: 56, PHM: 57,
  HEB: 58, JAS: 59, '1PE': 60, '2PE': 61, '1JN': 62, '2JN': 63, '3JN': 64, JUD: 65, REV: 66,
};

const PREDICATE_META = {
  grammatical_subject_of: {
    forward_label: 'Subject of',
    inverse_predicate: 'has_grammatical_subject',
    inverse_label: 'Has grammatical subject',
    guardrail: 'Syntactic subject role in source clause; does not imply semantic agency.',
  },
  grammatical_object_of: {
    forward_label: 'Direct object of',
    inverse_predicate: 'has_grammatical_object',
    inverse_label: 'Has direct object',
    guardrail: 'Syntactic direct object in source clause.',
  },
  grammatical_indirect_object_of: {
    forward_label: 'Indirect object of',
    inverse_predicate: 'has_grammatical_indirect_object',
    inverse_label: 'Has indirect object',
    guardrail: 'Syntactic indirect object / dative recipient role in source clause.',
  },
  grammatical_second_object_of: {
    forward_label: 'Second object of',
    inverse_predicate: 'has_grammatical_second_object',
    inverse_label: 'Has second object',
    guardrail: 'Syntactic second object / object complement in source clause.',
  },
  modifies: {
    forward_label: 'Modifies',
    inverse_predicate: 'modified_by',
    inverse_label: 'Modified by',
    guardrail: 'Verified syntactic modifier attachment to phrase head.',
  },
  possessive_construction_with: {
    forward_label: 'Genitive / construct connection',
    inverse_predicate: 'possessive_head_of',
    inverse_label: 'Head of genitive / construct',
    guardrail: 'Syntactic Hebrew construct chain or Greek genitive modifier; does not imply legal ownership or theological equivalence.',
  },
};

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function readJsonl(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  return raw.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

function readTableGz(tableName) {
  const dir = path.join(TABLES_DIR, tableName);
  const rows = [];
  for (const name of fs.readdirSync(dir).filter(x => x.endsWith('.jsonl.gz')).sort()) {
    const raw = zlib.gunzipSync(fs.readFileSync(path.join(dir, name))).toString('utf8').trim();
    if (!raw) continue;
    for (const line of raw.split(/\r?\n/)) {
      if (line) rows.push(JSON.parse(line));
    }
  }
  return rows;
}

function verifyR3Inputs() {
  const manifestPath = path.join(R3_DIR, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing R3 manifest: ${manifestPath}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const [relPath, entry] of Object.entries(manifest.files || {})) {
    const full = path.join(R3_DIR, relPath);
    if (!fs.existsSync(full)) {
      throw new Error(`Missing R3 artifact: ${full}`);
    }
    const bytes = fs.readFileSync(full);
    if (bytes.length !== entry.bytes) {
      throw new Error(`Size mismatch for ${relPath}: expected ${entry.bytes}, got ${bytes.length}`);
    }
    const digest = sha256Hex(bytes);
    if (digest !== entry.sha256) {
      throw new Error(`SHA-256 mismatch for ${relPath}: expected ${entry.sha256}, got ${digest}`);
    }
  }
  if (manifest.counts?.frames_emitted !== 460 || manifest.counts?.occurrence_relations_emitted !== 398 || manifest.counts?.relation_summaries_total !== 335) {
    throw new Error(`Unexpected R3 counts: ${JSON.stringify(manifest.counts)}`);
  }
  return manifest;
}

function parseRefCoords(ref) {
  const m = /^([1-3]?[A-Z]+)\s+(\d+):(\d+)$/.exec(String(ref || '').trim());
  if (!m) return null;
  const book = BOOK_NUM_BY_USFM[m[1]] || null;
  if (!book) return null;
  return { usfm: m[1], book, chapter: Number(m[2]), verse: Number(m[3]) };
}

function normalizeBaseStrongs(s) {
  const m = /^([HG])0*(\d+)$/i.exec(String(s || '').trim());
  if (!m) return null;
  return `${m[1].toUpperCase()}${Number(m[2])}`;
}

function normalizeLanguage(rawLang, lemmaKey) {
  const l = String(rawLang || '').toLowerCase();
  if (l === 'heb' || l === 'hbo' || l === 'hebrew') return 'hebrew';
  if (l === 'arc' || l === 'aramaic') return 'aramaic';
  if (l === 'grc' || l === 'greek') return 'greek';
  return String(lemmaKey || '').startsWith('lemma:G') ? 'greek' : 'hebrew';
}

function writeGzipShard(relWebPath, data) {
  const outPath = path.join(STATIC_CORPUS_DIR, relWebPath.replace(/^\//, ''));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const raw = Buffer.from(JSON.stringify(data), 'utf8');
  const gz = zlib.gzipSync(raw, { level: 9, mtime: 0 });
  fs.writeFileSync(outPath, gz);
  return {
    path: relWebPath,
    uncompressed_bytes: raw.length,
    compressed_bytes: gz.length,
    sha256_uncompressed: sha256Hex(raw),
    sha256_compressed: sha256Hex(gz),
  };
}

function main() {
  const r3Manifest = verifyR3Inputs();

  const frames = readJsonl(path.join(R3_DIR, 'frames.jsonl'));
  const relations = readJsonl(path.join(R3_DIR, 'occurrence-relations.jsonl'));
  const summaries = readJsonl(path.join(R3_DIR, 'summaries/lemma-relation-summaries.jsonl'));
  const evidenceEntries = readJsonl(path.join(R3_DIR, 'indexes/evidence-by-id.jsonl'));
  const byLemmaR3 = JSON.parse(fs.readFileSync(path.join(R3_DIR, 'indexes/by-lemma.json'), 'utf8'));
  const lanesR3 = JSON.parse(fs.readFileSync(path.join(R3_DIR, 'lanes/lexical-and-contextual-lanes.json'), 'utf8'));
  const coverageR3 = JSON.parse(fs.readFileSync(path.join(R3_DIR, 'coverage-report.json'), 'utf8'));
  const qualityR3 = JSON.parse(fs.readFileSync(path.join(R3_DIR, 'reports/r3-quality-report.json'), 'utf8'));

  // 1. Collect target lemmas appearing in R3 frames/summaries/lanes
  const graphLemmas = new Set(Object.keys(byLemmaR3));
  for (const fr of frames) {
    if (fr.predicate?.lemma_id) graphLemmas.add(fr.predicate.lemma_id);
    for (const r of fr.roles || []) if (r.lemma_id) graphLemmas.add(r.lemma_id);
  }
  for (const rel of relations) {
    if (rel.subject_lemma_id) graphLemmas.add(rel.subject_lemma_id);
    if (rel.object_lemma_id) graphLemmas.add(rel.object_lemma_id);
  }

  // 2. Load canonical lemma, lexeme, word_id metadata from static corpus tables
  const lemmasTable = readTableGz('lemmas');
  const lexemesTable = readTableGz('lexemes');
  const wflTable = readTableGz('word_form_lemmas');

  const lemmaRowByKey = new Map();
  const siblingsByBase = new Map();
  for (const row of lemmasTable) {
    lemmaRowByKey.set(row.lemma_key, row);
    const base = normalizeBaseStrongs(row.base_strongs);
    if (base) {
      if (!siblingsByBase.has(base)) siblingsByBase.set(base, []);
      siblingsByBase.get(base).push(row.lemma_key);
    }
  }
  for (const arr of siblingsByBase.values()) arr.sort();

  const lexemeById = new Map();
  const lexemeByLemmaId = new Map();
  for (const lx of lexemesTable) {
    lexemeById.set(lx.id, lx);
    if (lx.lemma_id && !lexemeByLemmaId.has(lx.lemma_id)) {
      lexemeByLemmaId.set(lx.lemma_id, lx);
    }
  }

  // Expand enriched profiles to include all homograph siblings of graph lemmas
  const enrichedLemmaKeys = new Set(graphLemmas);
  for (const lk of graphLemmas) {
    const row = lemmaRowByKey.get(lk);
    const base = normalizeBaseStrongs(row?.base_strongs);
    if (base && siblingsByBase.has(base)) {
      for (const sib of siblingsByBase.get(base)) enrichedLemmaKeys.add(sib);
    }
  }

  const targetNumericLemmaIds = new Set();
  for (const lk of enrichedLemmaKeys) {
    const row = lemmaRowByKey.get(lk);
    if (row) targetNumericLemmaIds.add(row.id);
  }

  const lemmaKeyByNumericId = new Map();
  for (const row of lemmasTable) lemmaKeyByNumericId.set(row.id, row.lemma_key);
  const allWordIdToLemmaKeys = new Map();
  for (const wfl of wflTable) {
    const lk = lemmaKeyByNumericId.get(wfl.lemma_id);
    if (!lk || !wfl.word_id) continue;
    if (!allWordIdToLemmaKeys.has(wfl.word_id)) allWordIdToLemmaKeys.set(wfl.word_id, new Set());
    allWordIdToLemmaKeys.get(wfl.word_id).add(lk);
  }

  const wordIdsByLemmaKey = new Map();
  for (const [wid, lkSet] of allWordIdToLemmaKeys.entries()) {
    for (const lk of lkSet) {
      if (!enrichedLemmaKeys.has(lk)) continue;
      if (!wordIdsByLemmaKey.has(lk)) wordIdsByLemmaKey.set(lk, new Set());
      wordIdsByLemmaKey.get(lk).add(wid);
    }
  }

  // 3. Map covered chapter tokens to (word_position, word_id, text_form, gloss)
  const chapterCache = new Map();
  function getChapter(book, chapter) {
    const k = `b${book}-c${chapter}`;
    if (!chapterCache.has(k)) {
      const p = path.join(CHAPTERS_DIR, `${k}.json.gz`);
      chapterCache.set(k, fs.existsSync(p) ? JSON.parse(zlib.gunzipSync(fs.readFileSync(p)).toString('utf8')) : null);
    }
    return chapterCache.get(k);
  }

  const tokenMetaByEditionId = new Map();
  const occurrenceToLemma = {};
  const tokenToLemma = {};
  const coveredRefsByEdition = new Map();

  // Build token -> lemma_id map from covered frames
  for (const fr of frames) {
    const ed = fr.source?.edition;
    const ref = fr.source?.reference;
    if (ed && ref) {
      if (!coveredRefsByEdition.has(ed)) coveredRefsByEdition.set(ed, new Set());
      coveredRefsByEdition.get(ed).add(ref);
    }
    if (fr.predicate?.token_id && fr.predicate?.lemma_id) {
      tokenToLemma[`${ed}:${fr.predicate.token_id}`] = fr.predicate.lemma_id;
    }
    for (const r of fr.roles || []) {
      if (r.head_token_id && r.lemma_id) {
        tokenToLemma[`${ed}:${r.head_token_id}`] = r.lemma_id;
      }
    }
  }
  for (const rel of relations) {
    const ed = rel.evidence?.edition;
    if (rel.subject_token_id && rel.subject_lemma_id) {
      tokenToLemma[`${ed}:${rel.subject_token_id}`] = rel.subject_lemma_id;
    }
    if (rel.object_token_id && rel.object_lemma_id) {
      tokenToLemma[`${ed}:${rel.object_token_id}`] = rel.object_lemma_id;
    }
  }

  const uniqueRefs = new Set(frames.map(f => f.source?.reference).filter(Boolean));
  for (const ref of [...uniqueRefs].sort()) {
    const coords = parseRefCoords(ref);
    if (!coords) continue;
    const ch = getChapter(coords.book, coords.chapter);
    const vObj = ch?.verses?.[String(coords.verse)];
    if (!vObj) continue;

    // Build stem lemma map per word_position from reader tokens
    const stemLemmaByPos = new Map();
    for (const tok of vObj.tokens || []) {
      const stem = (tok.morphemes || []).find(m => m.morpheme_role === 'stem') || tok.morphemes?.[0];
      if (stem?.lemma_key) stemLemmaByPos.set(tok.word_position, stem.lemma_key);
    }

    for (const mh of vObj.macula_hebrew_morphemes || []) {
      const ed = 'macula-hebrew-wlc';
      const meta = {
        edition: ed,
        reference: ref,
        book: coords.book,
        chapter: coords.chapter,
        verse: coords.verse,
        word_position: mh.word_no,
        morph_no: mh.morph_no,
        word_id: mh.word_id,
        token_id: mh.macula_id,
        surface_form: mh.text_form,
        gloss: mh.gloss || '',
      };
      tokenMetaByEditionId.set(`${ed}:${mh.macula_id}`, meta);
      const exactLemma = tokenToLemma[`${ed}:${mh.macula_id}`] || stemLemmaByPos.get(mh.word_no);
      if (exactLemma) {
        const occKey = `${ed}:${ref}#${mh.word_no}`;
        const existing = occurrenceToLemma[occKey];
        if (!existing || tokenToLemma[`${ed}:${mh.macula_id}`] || mh.morph_no === 1) {
          occurrenceToLemma[occKey] = {
            lemma_id: exactLemma,
            token_id: mh.macula_id,
            word_id: mh.word_id,
            word_position: mh.word_no,
            surface_form: mh.text_form,
            edition: ed,
            reference: ref,
          };
        }
      }
    }

    for (const mg of vObj.macula_greek_tokens || []) {
      const ed = mg.edition_key;
      const meta = {
        edition: ed,
        reference: ref,
        book: coords.book,
        chapter: coords.chapter,
        verse: coords.verse,
        word_position: mg.word_no,
        morph_no: 1,
        word_id: mg.step_word_id,
        token_id: mg.xml_id,
        surface_form: mg.text_form,
        gloss: mg.gloss || '',
      };
      tokenMetaByEditionId.set(`${ed}:${mg.xml_id}`, meta);
      const exactLemma = tokenToLemma[`${ed}:${mg.xml_id}`] || stemLemmaByPos.get(mg.word_no);
      if (exactLemma) {
        occurrenceToLemma[`${ed}:${ref}#${mg.word_no}`] = {
          lemma_id: exactLemma,
          token_id: mg.xml_id,
          word_id: mg.step_word_id,
          word_position: mg.word_no,
          surface_form: mg.text_form,
          edition: ed,
          reference: ref,
        };
      }
    }
  }

  // 4. Construct enriched lemma profiles
  const lemmaProfiles = {};
  for (const lk of [...enrichedLemmaKeys].sort()) {
    const lr = lemmaRowByKey.get(lk);
    const lx = lr ? (lexemeById.get(lr.primary_lexeme_id) || lexemeByLemmaId.get(lr.id)) : null;
    const lane = lanesR3[lk]?.lexical_lane;
    const baseStrongs = normalizeBaseStrongs(lr?.base_strongs || lane?.strongs_base);
    const wids = [...(wordIdsByLemmaKey.get(lk) || [])].sort((a, b) => a - b);
    const r3Entry = byLemmaR3[lk];
    lemmaProfiles[lk] = {
      lemma_id: lk,
      language: normalizeLanguage(lr?.language, lk),
      lemma_form: lr?.lemma_script || lane?.lemma_form || lk.replace(/^lemma:/, ''),
      lemma_stripped: lr?.lemma_stripped || null,
      transliteration: lr?.transliteration || null,
      gloss: lx?.primary_gloss || null,
      homograph_note: lx?.homograph_note || null,
      strongs_base: baseStrongs,
      extended_strongs: lk.startsWith('lemma:') ? lk.slice('lemma:'.length) : lk,
      pos: lr?.primary_pos || null,
      primary_word_id: wids[0] || null,
      word_ids: wids.slice(0, 12),
      homograph_siblings: baseStrongs ? (siblingsByBase.get(baseStrongs) || [lk]) : [lk],
      in_r3_graph: Boolean(r3Entry),
      editions: r3Entry?.editions || [],
      outgoing_summary_count: r3Entry?.outgoing_summaries?.length || 0,
      incoming_summary_count: r3Entry?.incoming_summaries?.length || 0,
    };
  }

  // 5. Build complete canonical resolver index (so uncovered words still resolve cleanly without collapsing homographs)
  const byBaseStrongs = {};
  for (const [base, keys] of siblingsByBase.entries()) {
    byBaseStrongs[base] = keys;
  }

  // Keep hot resolver-index compact (< 1 MB uncompressed): full profiles for graph + sibling lemmas,
  // word_id map for graph + sibling lemmas, and by_strongs_base for ALL canonical Strong's numbers.
  const graphWordIdMap = {};
  for (const [lk, wids] of wordIdsByLemmaKey.entries()) {
    for (const wid of wids) {
      const k = String(wid);
      if (!graphWordIdMap[k]) graphWordIdMap[k] = [];
      if (!graphWordIdMap[k].includes(lk)) graphWordIdMap[k].push(lk);
    }
  }
  for (const arr of Object.values(graphWordIdMap)) arr.sort();

  const compactUncoveredLemmas = {};
  for (const row of lemmasTable) {
    const lk = row.lemma_key;
    if (lemmaProfiles[lk]) continue;
    const lx = lexemeById.get(row.primary_lexeme_id) || lexemeByLemmaId.get(row.id);
    compactUncoveredLemmas[lk] = [
      row.lemma_script || '',
      row.transliteration || '',
      lx?.primary_gloss || '',
      normalizeBaseStrongs(row.base_strongs) || '',
      row.primary_pos || '',
    ];
  }

  const bySurfaceForm = {};
  for (const [lk, prof] of Object.entries(lemmaProfiles)) {
    for (const s of [prof.lemma_form, prof.lemma_stripped]) {
      if (!s) continue;
      if (!bySurfaceForm[s]) bySurfaceForm[s] = [];
      if (!bySurfaceForm[s].includes(lk)) bySurfaceForm[s].push(lk);
    }
  }

  const coveredPassagesByEdition = {};
  for (const [ed, set] of coveredRefsByEdition.entries()) {
    coveredPassagesByEdition[ed] = [...set].sort();
  }

  // 6. Enrich evidence records and index by relation_id and summary_id
  const frameById = new Map(frames.map(f => [f.frame_id, f]));
  const evidenceByRelationId = {};
  const evidenceIdsBySummaryId = {};

  for (const ev of evidenceEntries) {
    const rel = ev.relation;
    const fr = frameById.get(rel.frame_id);
    const ed = rel.evidence.edition;
    const subjTok = tokenMetaByEditionId.get(`${ed}:${rel.subject_token_id}`) || null;
    const objTok = tokenMetaByEditionId.get(`${ed}:${rel.object_token_id}`) || null;
    const subjProf = lemmaProfiles[rel.subject_lemma_id] || null;
    const objProf = lemmaProfiles[rel.object_lemma_id] || null;

    const record = {
      relation_id: rel.relation_id,
      summary_id: ev.summary_id,
      frame_id: rel.frame_id,
      source_clause_id: rel.evidence.source_clause_id,
      edition: ed,
      language: ev.language,
      canonical_ref: rel.evidence.reference,
      coords: parseRefCoords(rel.evidence.reference),
      predicate: rel.predicate,
      inverse_predicate: ev.inverse_predicate,
      quality: rel.quality,
      rule_id: rel.evidence.rule_id,
      rule_version: fr?.extraction?.rule_version || r3Manifest.rule_version,
      qualifiers: rel.qualifiers,
      frame_context: fr ? {
        clause_node_id: fr.source?.clause_node_id || rel.evidence.source_clause_id,
        predicate_token_id: fr.predicate?.token_id || null,
        predicate_lemma_id: fr.predicate?.lemma_id || null,
        predicate_form: fr.predicate?.source_form || null,
        context: fr.context,
        alignment_status: fr.source?.alignment_status || null,
      } : null,
      subject: {
        lemma_id: rel.subject_lemma_id,
        token_id: rel.subject_token_id,
        word_id: subjTok?.word_id || subjProf?.primary_word_id || null,
        word_position: subjTok?.word_position || null,
        surface_form: subjTok?.surface_form || subjProf?.lemma_form || null,
        lemma_form: subjProf?.lemma_form || null,
        transliteration: subjProf?.transliteration || null,
        gloss: subjTok?.gloss || subjProf?.gloss || null,
      },
      object: {
        lemma_id: rel.object_lemma_id,
        token_id: rel.object_token_id,
        word_id: objTok?.word_id || objProf?.primary_word_id || null,
        word_position: objTok?.word_position || null,
        surface_form: objTok?.surface_form || objProf?.lemma_form || null,
        lemma_form: objProf?.lemma_form || null,
        transliteration: objProf?.transliteration || null,
        gloss: objTok?.gloss || objProf?.gloss || null,
      },
    };
    evidenceByRelationId[rel.relation_id] = record;
    if (!evidenceIdsBySummaryId[ev.summary_id]) evidenceIdsBySummaryId[ev.summary_id] = [];
    evidenceIdsBySummaryId[ev.summary_id].push(rel.relation_id);
  }

  // 7. Build enriched by-lemma shard
  const enrichSummary = (s, direction) => {
    const pMeta = PREDICATE_META[s.predicate] || {};
    const targetLemmaId = direction === 'outgoing' ? s.to_lemma_id : s.from_lemma_id;
    const focusLemmaId = direction === 'outgoing' ? s.from_lemma_id : s.to_lemma_id;
    const evIds = s.evidence_ids || evidenceIdsBySummaryId[s.summary_id] || [];
    const sampleEv = evIds.slice(0, 5).map(id => evidenceByRelationId[id]).filter(Boolean);
    const qualities = [...new Set(sampleEv.map(e => e.quality))];
    return {
      ...s,
      direction,
      display_predicate: direction === 'outgoing' ? s.predicate : (s.inverse_predicate || pMeta.inverse_predicate),
      display_label: direction === 'outgoing' ? (pMeta.forward_label || s.predicate) : (pMeta.inverse_label || s.inverse_predicate),
      guardrail: pMeta.guardrail || null,
      focus_lemma_id: focusLemmaId,
      related_lemma_id: targetLemmaId,
      related_lemma: lemmaProfiles[targetLemmaId] || null,
      from_lemma: lemmaProfiles[s.from_lemma_id] || null,
      to_lemma: lemmaProfiles[s.to_lemma_id] || null,
      sample_passages: (s.sample_passages || []).map(ref => ({ reference: ref, coords: parseRefCoords(ref) })),
      sample_qualities: qualities,
    };
  };

  const enrichedByLemma = {};
  for (const [lk, entry] of Object.entries(byLemmaR3)) {
    enrichedByLemma[lk] = {
      lemma_id: lk,
      profile: lemmaProfiles[lk] || null,
      editions: entry.editions || [],
      outgoing_summaries: (entry.outgoing_summaries || []).map(s => enrichSummary(s, 'outgoing')),
      incoming_summaries: (entry.incoming_summaries || []).map(s => enrichSummary(s, 'incoming')),
      predicate_meta: PREDICATE_META,
    };
  }

  // 8. Build passage-by-ref index (frames + occurrence relations keyed by edition and ref)
  const relsByFrameId = new Map();
  for (const rel of relations) {
    if (!relsByFrameId.has(rel.frame_id)) relsByFrameId.set(rel.frame_id, []);
    relsByFrameId.get(rel.frame_id).push(evidenceByRelationId[rel.relation_id]);
  }

  const passagesByEditionAndRef = {};
  for (const fr of frames) {
    const ed = fr.source?.edition;
    const ref = fr.source?.reference;
    if (!ed || !ref) continue;
    const key = `${ed}:${ref}`;
    if (!passagesByEditionAndRef[key]) {
      passagesByEditionAndRef[key] = {
        edition: ed,
        reference: ref,
        coords: parseRefCoords(ref),
        frames: [],
        relations: [],
      };
    }
    const enrichedRoles = (fr.roles || []).map(r => {
      const tok = r.head_token_id ? tokenMetaByEditionId.get(`${ed}:${r.head_token_id}`) : null;
      const prof = r.lemma_id ? lemmaProfiles[r.lemma_id] : null;
      return {
        ...r,
        word_id: tok?.word_id || prof?.primary_word_id || null,
        word_position: tok?.word_position || null,
        surface_form: tok?.surface_form || null,
        lemma_form: prof?.lemma_form || null,
        transliteration: prof?.transliteration || null,
        gloss: tok?.gloss || prof?.gloss || null,
      };
    });
    const predTok = fr.predicate?.token_id ? tokenMetaByEditionId.get(`${ed}:${fr.predicate.token_id}`) : null;
    const predProf = fr.predicate?.lemma_id ? lemmaProfiles[fr.predicate.lemma_id] : null;
    const enrichedFrame = {
      ...fr,
      predicate: fr.predicate ? {
        ...fr.predicate,
        word_id: predTok?.word_id || predProf?.primary_word_id || null,
        word_position: predTok?.word_position || null,
        lemma_form: predProf?.lemma_form || null,
        transliteration: predProf?.transliteration || null,
        gloss: predTok?.gloss || predProf?.gloss || null,
      } : null,
      roles: enrichedRoles,
    };
    passagesByEditionAndRef[key].frames.push(enrichedFrame);
    for (const relRec of relsByFrameId.get(fr.frame_id) || []) {
      passagesByEditionAndRef[key].relations.push(relRec);
    }
  }

  // 9. Write release shards
  const shards = {
    resolver_index: writeGzipShard(`/v2/relationships/${RELEASE_VERSION}/resolver-index.json.gz`, {
      schema_version: '2.0',
      release_version: RELEASE_VERSION,
      rule_version: r3Manifest.rule_version,
      lemmas: lemmaProfiles,
      by_strongs_base: byBaseStrongs,
      by_word_id: graphWordIdMap,
      by_surface_form: bySurfaceForm,
      occurrence_to_lemma: occurrenceToLemma,
      token_to_lemma: tokenToLemma,
      covered_passages_by_edition: coveredPassagesByEdition,
      predicate_meta: PREDICATE_META,
    }),
    uncovered_lemmas: writeGzipShard(`/v2/relationships/${RELEASE_VERSION}/uncovered-lemmas.json.gz`, {
      schema_version: '2.0',
      release_version: RELEASE_VERSION,
      rule_version: r3Manifest.rule_version,
      tuples_schema: ['lemma_form', 'transliteration', 'gloss', 'strongs_base', 'pos'],
      entries: compactUncoveredLemmas,
    }),
    by_lemma: writeGzipShard(`/v2/relationships/${RELEASE_VERSION}/by-lemma.json.gz`, {
      schema_version: '2.0',
      release_version: RELEASE_VERSION,
      rule_version: r3Manifest.rule_version,
      entries: enrichedByLemma,
    }),
    passages_by_ref: writeGzipShard(`/v2/relationships/${RELEASE_VERSION}/passages-by-ref.json.gz`, {
      schema_version: '2.0',
      release_version: RELEASE_VERSION,
      rule_version: r3Manifest.rule_version,
      passages: passagesByEditionAndRef,
    }),
    evidence_by_id: writeGzipShard(`/v2/relationships/${RELEASE_VERSION}/evidence-by-id.json.gz`, {
      schema_version: '2.0',
      release_version: RELEASE_VERSION,
      rule_version: r3Manifest.rule_version,
      by_relation_id: evidenceByRelationId,
      by_summary_id: evidenceIdsBySummaryId,
    }),
    coverage_report: writeGzipShard(`/v2/relationships/${RELEASE_VERSION}/coverage-report.json.gz`, coverageR3),
    quality_report: writeGzipShard(`/v2/relationships/${RELEASE_VERSION}/quality-report.json.gz`, qualityR3),
  };

  const releaseManifest = {
    schema_version: '2.0',
    release_version: RELEASE_VERSION,
    previous_release_version: null,
    rule_version: r3Manifest.rule_version,
    generated_at: r3Manifest.generated_at,
    source_git_commit: SOURCE_GIT_COMMIT,
    upstream_bibleontology_commit: r3Manifest.upstream_bibleontology_commit,
    source_releases: r3Manifest.source_releases,
    counts: {
      ...r3Manifest.counts,
      enriched_graph_lemmas: Object.keys(lemmaProfiles).length,
      canonical_lemmas_indexed: Object.keys(lemmaProfiles).length + Object.keys(compactUncoveredLemmas).length,
      covered_occurrences_mapped: Object.keys(occurrenceToLemma).length,
      covered_passages_by_edition: Object.fromEntries(
        Object.entries(coveredPassagesByEdition).map(([ed, arr]) => [ed, arr.length])
      ),
    },
    predicates: Object.keys(PREDICATE_META),
    predicate_meta: PREDICATE_META,
    input_manifest_files: r3Manifest.files,
    shards,
  };

  const manifestMeta = writeGzipShard(`/v2/relationships/${RELEASE_VERSION}/manifest.json.gz`, releaseManifest);
  const activePointer = {
    schema_version: '2.0',
    active_release: RELEASE_VERSION,
    previous_release: null,
    rule_version: r3Manifest.rule_version,
    source_git_commit: SOURCE_GIT_COMMIT,
    manifest_path: `/v2/relationships/${RELEASE_VERSION}/manifest.json.gz`,
    manifest_sha256_compressed: manifestMeta.sha256_compressed,
    shards: Object.fromEntries(Object.entries(shards).map(([k, v]) => [k, v.path])),
    counts: releaseManifest.counts,
  };
  const activeMeta = writeGzipShard('/v2/relationships/active.json.gz', activePointer);

  console.log(JSON.stringify({
    status: 'ok',
    release_version: RELEASE_VERSION,
    active_pointer: activeMeta,
    manifest: manifestMeta,
    shards,
    counts: releaseManifest.counts,
  }, null, 2));
}

main();
