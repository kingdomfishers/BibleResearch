#!/usr/bin/env node
/**
 * Builds the non-destructive R12 QA-corrected staging bundle at `.artifacts-r12/staging-bundle`:
 * - Materializes base bundle from `.artifacts-r10/deploy-bundle` (preserving all existing releases).
 * - Emits versioned `r8-v1.2` fixing occurrence STEP `word_id`, 1-based canonical `word_position`,
 *   actual `surface_form`, and explicit `source_token_id` + `word_id_status` across frames,
 *   relations, evidence, and by-lemma summaries, plus 64-bucket `word-id-index`.
 * - Emits versioned `r9b-v1.1` pointing `grammatical` to `r8-v1.2` and `contextual` to
 *   `r9b-v1.1/contextual` with guaranteed `same_clause_samples` and `collocation_samples`.
 * - Cleans Swete LXX chapter-heading Roman numeral prefixes in `v1/lxx/b*.json.gz` while
 *   preserving `raw_source_word_text` and source provenance.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { packLemmaShard } from './relationship-shard-codec.mjs';

const REPO_ROOT = path.resolve('.');
const BASE_BUNDLE = path.join(REPO_ROOT, '.artifacts-r10', 'deploy-bundle');
const TABLES_DIR = path.join(REPO_ROOT, '.artifacts', 'static-corpus', 'tables');
const OUT_BUNDLE = path.join(REPO_ROOT, '.artifacts-r12', 'staging-bundle');

const CF_MAX_ASSETS = 20_000;
const CF_MAX_FILE_BYTES = 25 * 1024 * 1024;

const USFM_BY_BOOK = [
  '', 'GEN', 'EXO', 'LEV', 'NUM', 'DEU', 'JOS', 'JDG', 'RUT', '1SA', '2SA',
  '1KI', '2KI', '1CH', '2CH', 'EZR', 'NEH', 'EST', 'JOB', 'PSA', 'PRO',
  'ECC', 'SNG', 'ISA', 'JER', 'LAM', 'EZK', 'DAN', 'HOS', 'JOL', 'AMO',
  'OBA', 'JON', 'MIC', 'NAM', 'HAB', 'ZEP', 'HAG', 'ZEC', 'MAL', 'MAT',
  'MRK', 'LUK', 'JHN', 'ACT', 'ROM', '1CO', '2CO', 'GAL', 'EPH', 'PHP',
  'COL', '1TH', '2TH', '1TI', '2TI', 'TIT', 'PHM', 'HEB', 'JAS', '1PE',
  '2PE', '1JN', '2JN', '3JN', 'JUD', 'REV',
];

const FNV_OFFSET_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

function fnv1a64Hex(input) {
  let hash = FNV_OFFSET_64;
  const str = String(input);
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash = (hash * FNV_PRIME_64) & MASK_64;
  }
  return hash.toString(16).padStart(16, '0');
}

function bucketHex(buckets, key) {
  const idx = Number(BigInt('0x' + fnv1a64Hex(key)) % BigInt(buckets));
  const pad = Math.max(2, Math.ceil(Math.log2(buckets) / 4));
  return idx.toString(16).padStart(pad, '0');
}

function readGzJson(filePath) {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(filePath)).toString('utf8'));
}

function writeGzJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const raw = Buffer.from(JSON.stringify(data), 'utf8');
  const gz = zlib.gzipSync(raw, { level: 9, mtime: 0 });
  // Staging may share hardlinks with the preserved base bundle. Replace the
  // directory entry rather than mutating the shared inode.
  fs.writeFileSync(filePath + '.r12-tmp', gz);
  fs.renameSync(filePath + '.r12-tmp', filePath);
  return {
    uncompressed_bytes: raw.length,
    compressed_bytes: gz.length,
    sha256_compressed: crypto.createHash('sha256').update(gz).digest('hex'),
  };
}

function streamTable(tableName, onRow) {
  const dir = path.join(TABLES_DIR, tableName);
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.jsonl.gz')).sort()) {
    const lines = zlib.gunzipSync(fs.readFileSync(path.join(dir, f))).toString('utf8').split(/\r?\n/);
    for (const l of lines) {
      if (l) onRow(JSON.parse(l));
    }
  }
}

function copyDirHardlinkOrCopy(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  let count = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      count += copyDirHardlinkOrCopy(s, d);
    } else {
      if (fs.existsSync(d)) fs.unlinkSync(d);
      try {
        fs.linkSync(s, d);
      } catch {
        fs.copyFileSync(s, d);
      }
      count++;
    }
  }
  return count;
}

function parseTokenPosition(tokenId) {
  if (!tokenId) return null;
  const s = String(tokenId);
  if ((s.startsWith('n') || s.startsWith('o')) && s.length >= 12) {
    const n = Number(s.slice(9, 12));
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  return null;
}

function toRoman(num) {
  const vals = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'],
    [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let out = '';
  let n = num;
  for (const [v, s] of vals) {
    while (n >= v) {
      out += s;
      n -= v;
    }
  }
  return out;
}

function stripGreekDiacritics(text) {
  if (!text) return '';
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036F\u1DC0-\u1DFF\u1F00-\u1FFF.,;:·"᾽᾿῀῁()[\]{}«»—\-!]/g, '')
    .toLowerCase()
    .normalize('NFC');
}

function walkFiles(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(p, base));
    else out.push({ full: p, rel: path.relative(base, p).replace(/\\/g, '/'), size: fs.statSync(p).size });
  }
  return out;
}

async function main() {
  const onlyContextual = process.argv.includes('--only-contextual');
  const t0 = Date.now();
  console.log('=== Building R12 Staging Bundle ===');
  assert.ok(fs.existsSync(BASE_BUNDLE), `Missing base bundle: ${BASE_BUNDLE}`);

  if (!onlyContextual) {
    console.log('1/5 Materializing base bundle ->', OUT_BUNDLE);
    fs.rmSync(OUT_BUNDLE, { recursive: true, force: true });
    copyDirHardlinkOrCopy(BASE_BUNDLE, OUT_BUNDLE);
  }

  console.log('2/5 Loading authoritative static tables...');
  const verseWordPos = new Map(); // cvid -> Map<word_id, number[]>
  const versesList = [];
  streamTable('verses_immutable', v => {
    versesList.push(v);
    const m = new Map();
    (v.word_ids || []).forEach((wid, idx) => {
      if (!m.has(wid)) m.set(wid, []);
      m.get(wid).push(idx + 1);
    });
    verseWordPos.set(v.id, m);
  });

  const lemmaKeyById = new Map();
  streamTable('lemmas', l => lemmaKeyById.set(l.id, l.lemma_key));

  if (!onlyContextual) {
  const wordSurfaceMap = new Map();
  streamTable('words_immutable', w => {
    if (w.id && w.original_word) wordSurfaceMap.set(w.id, w.original_word);
  });

  const hebTokenMap = new Map();
  streamTable('macula_hebrew_morphemes', r => {
    if (r.macula_id) {
      hebTokenMap.set(r.macula_id, {
        word_id: r.word_id ?? null,
        cvid: r.canonical_verse_id ?? null,
        word_no: r.word_no ?? null,
      });
    }
  });

  const grkTokenMap = new Map();
  streamTable('macula_greek_tokens', r => {
    if (r.edition_key && r.xml_id) {
      grkTokenMap.set(`${r.edition_key}:${r.xml_id}`, {
        word_id: r.step_word_id ?? null,
        cvid: r.canonical_verse_id ?? null,
      });
    }
  });

  function resolveOccurrenceToken(edition, tokenId, fallbackSourceForm = null) {
    if (!tokenId) {
      return {
        word_id: null,
        word_position: null,
        source_token_id: null,
        word_id_status: 'unresolved',
        surface_form: fallbackSourceForm || null,
      };
    }
    const isHeb = edition === 'macula-hebrew-wlc' || String(tokenId).startsWith('o');
    const rec = isHeb
      ? hebTokenMap.get(tokenId)
      : grkTokenMap.get(`${edition}:${tokenId}`);
    const parsedPos = parseTokenPosition(tokenId);
    if (!rec || rec.word_id == null) {
      return {
        word_id: null,
        word_position: parsedPos,
        source_token_id: tokenId,
        word_id_status: 'unresolved',
        surface_form: fallbackSourceForm || null,
      };
    }
    const stepWid = Number(rec.word_id);
    const posList = rec.cvid != null ? verseWordPos.get(Number(rec.cvid))?.get(stepWid) : null;
    let canonicalPos = parsedPos;
    if (posList && posList.length > 0) {
      if (posList.length === 1) canonicalPos = posList[0];
      else if (parsedPos && posList.includes(parsedPos)) canonicalPos = parsedPos;
      else if (rec.word_no && posList.includes(rec.word_no)) canonicalPos = rec.word_no;
      else canonicalPos = posList[0];
    } else if (rec.word_no) {
      canonicalPos = rec.word_no;
    }
    return {
      word_id: stepWid,
      word_position: canonicalPos,
      source_token_id: tokenId,
      word_id_status: 'verified_occurrence',
      surface_form: wordSurfaceMap.get(stepWid) || fallbackSourceForm || null,
    };
  }

  function fixTokenHolder(holder, edition, tokenId, fallbackSurface = null) {
    if (!holder || typeof holder !== 'object') return holder;
    const tid = tokenId || holder.token_id || holder.head_token_id || null;
    const resolved = resolveOccurrenceToken(edition, tid, fallbackSurface || holder.source_form || null);
    return {
      ...holder,
      ...(tid ? { source_token_id: tid } : {}),
      word_id: resolved.word_id,
      word_position: resolved.word_position,
      word_id_status: resolved.word_id_status,
      surface_form: resolved.surface_form || holder.surface_form || null,
    };
  }

  function fixRelationRecord(rel) {
    const ed = rel.edition;
    return {
      ...rel,
      subject: fixTokenHolder(rel.subject, ed, rel.subject?.token_id),
      object: fixTokenHolder(rel.object, ed, rel.object?.token_id),
    };
  }

  function fixFrameRecord(fr) {
    const ed = fr.source?.edition;
    return {
      ...fr,
      predicate: fr.predicate ? fixTokenHolder(fr.predicate, ed, fr.predicate.token_id, fr.predicate.source_form) : null,
      roles: (fr.roles || []).map(role => fixTokenHolder(role, ed, role.head_token_id)),
    };
  }

  console.log('3/5 Building versioned R8 release r8-v1.2 (preserving r8-v1.1)...');
  const r8Src = path.join(OUT_BUNDLE, 'v2', 'relationships', 'r8-v1.1');
  const r8Dst = path.join(OUT_BUNDLE, 'v2', 'relationships', 'r8-v1.2');
  fs.rmSync(r8Dst, { recursive: true, force: true });
  fs.mkdirSync(r8Dst, { recursive: true });

  // Copy/fix passages, evidence, evidence/by-summary, by-lemma
  for (const sub of ['passages', 'evidence', 'by-lemma']) {
    const srcSub = path.join(r8Src, sub);
    const dstSub = path.join(r8Dst, sub);
    for (const item of walkFiles(srcSub)) {
      if (!item.rel.endsWith('.json.gz')) continue;
      const data = readGzJson(item.full);
      if (sub === 'passages' && data.passages) {
        for (const p of Object.values(data.passages)) {
          p.frames = (p.frames || []).map(fixFrameRecord);
          p.relations = (p.relations || []).map(fixRelationRecord);
        }
      } else if (sub === 'evidence' && item.rel.startsWith('by-summary/') && data.entries) {
        for (const [sid, arr] of Object.entries(data.entries)) {
          data.entries[sid] = (arr || []).map(fixRelationRecord);
        }
      } else if (sub === 'evidence' && data.by_relation_id) {
        for (const [rid, rel] of Object.entries(data.by_relation_id)) {
          data.by_relation_id[rid] = fixRelationRecord(rel);
        }
      } else if (sub === 'by-lemma' && data.entries) {
        for (const entry of Object.values(data.entries)) {
          for (const field of ['outgoing_summaries', 'incoming_summaries']) {
            for (const sum of entry[field] || []) {
              if (Array.isArray(sum.sample_relations)) {
                const fixedRels = sum.sample_relations.map(fixRelationRecord);
                sum.evidence_ids = fixedRels.map(r => r.relation_id).filter(Boolean);
                sum.sample_passages = [...new Set(fixedRels.map(r => r.canonical_ref).filter(Boolean))].map(reference => ({
                  reference,
                  coords: fixedRels.find(r => r.canonical_ref === reference)?.coords || null,
                }));
                delete sum.sample_relations;
              }
              if (sum.related_lemma) {
                sum.from_lemma = null;
                sum.to_lemma = null;
              }
            }
          }
        }
      }
      writeGzJson(path.join(dstSub, item.rel), sub === 'by-lemma' ? packLemmaShard(data) : data);
    }
  }

  // Copy resolver-index, uncovered-lemmas, coverage-report, quality-report + emit 64-bucket word-id-index
  const resolverIdx = readGzJson(path.join(r8Src, 'resolver-index.json.gz'));
  resolverIdx.release_version = 'r8-v1.2';
  writeGzJson(path.join(r8Dst, 'resolver-index.json.gz'), resolverIdx);

  // Build 64-bucket word-id-index from resolverIdx.by_word_id + word_form_lemmas for complete coverage
  const fullWordIdMap = new Map();
  for (const [widStr, lks] of Object.entries(resolverIdx.by_word_id || {})) {
    fullWordIdMap.set(widStr, new Set(lks));
  }
  streamTable('word_form_lemmas', wfl => {
    const lk = lemmaKeyById.get(wfl.lemma_id);
    if (!lk || !wfl.word_id) return;
    const k = String(wfl.word_id);
    if (!fullWordIdMap.has(k)) fullWordIdMap.set(k, new Set());
    fullWordIdMap.get(k).add(lk);
  });
  const wordIdBuckets = Array.from({ length: 64 }, () => ({}));
  for (const [widStr, lkSet] of fullWordIdMap.entries()) {
    const bHex = bucketHex(64, widStr);
    wordIdBuckets[parseInt(bHex, 16)][widStr] = [...lkSet].sort();
  }
  for (let i = 0; i < 64; i++) {
    const bHex = i.toString(16).padStart(2, '0');
    writeGzJson(path.join(r8Dst, 'word-id-index', `shard-${bHex}.json.gz`), {
      schema_version: '1.0',
      bucket: bHex,
      entries: wordIdBuckets[i],
    });
  }

  // Build 64-bucket chapter-lite shards (compact WEB text + token coordinates) so cold Worker reads stay < 350 KiB instead of 3-8 MiB
  const chapterLiteBuckets = Array.from({ length: 64 }, () => ({}));
  const chaptersDir = path.join(OUT_BUNDLE, 'v1', 'chapters');
  for (const chFile of fs.readdirSync(chaptersDir).filter(x => /^b\d+-c\d+\.json\.gz$/.test(x)).sort()) {
    const m = /^b(\d+)-c(\d+)\.json\.gz$/.exec(chFile);
    if (!m) continue;
    const chKey = `${m[1]}:${m[2]}`;
    const bIdx = parseInt(bucketHex(64, chKey), 16);
    const chData = readGzJson(path.join(chaptersDir, chFile));
    const versesOut = {};
    for (const [vNr, vObj] of Object.entries(chData.verses || {})) {
      const webp = (vObj.english_editions || []).find(e => e.edition_id === 'webp-2026-11');
      const toks = (vObj.tokens || []).map(t => [
        Number(t.word_position),
        t.word_id ?? null,
        t.surface_form || null,
        t.base_strongs || null,
        (t.morphemes || []).map(mr => [mr.morpheme_role || '', mr.lemma_key || '']),
      ]);
      versesOut[vNr] = { web: webp ? webp.text : null, t: toks };
    }
    chapterLiteBuckets[bIdx][chKey] = versesOut;
  }
  for (let i = 0; i < 64; i++) {
    const bHex = i.toString(16).padStart(2, '0');
    writeGzJson(path.join(r8Dst, 'chapter-lite', `shard-${bHex}.json.gz`), {
      schema_version: '1.0',
      bucket: bHex,
      chapters: chapterLiteBuckets[i],
    });
  }

  for (const metaFile of ['uncovered-lemmas.json.gz', 'coverage-report.json.gz', 'quality-report.json.gz']) {
    const obj = readGzJson(path.join(r8Src, metaFile));
    if (obj.release_version) obj.release_version = 'r8-v1.2';
    writeGzJson(path.join(r8Dst, metaFile), obj);
  }
  const r8Manifest = readGzJson(path.join(r8Src, 'manifest.json.gz'));
  r8Manifest.release_version = 'r8-v1.2';
  r8Manifest.previous_release = 'r8-v1.1';
  r8Manifest.sharding = {
    ...r8Manifest.sharding,
    word_id_index: true,
    word_id_index_buckets: 64,
    chapter_lite_index: true,
    chapter_lite_buckets: 64,
  };
  r8Manifest.fixes_applied = ['QA-01/QA-04/QA-07/QA-10: exact occurrence STEP word_id, 1-based canonical word_position, actual surface_form, source_token_id provenance'];
  writeGzJson(path.join(r8Dst, 'manifest.json.gz'), r8Manifest);
  writeGzJson(path.join(r8Dst, 'runtime-manifest.json.gz'), r8Manifest);
  console.log(`  r8-v1.2 built in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
  } // end !onlyContextual

  console.log('4/5 Building versioned R9B contextual witnesses r9b-v1.1 (QA-11)...');
  // Stream word_form_lemmas (stem lemma) and syntax_nodes to collect verified same_clause and collocation witness passages
  const wordToStemLemmaKey = new Map();
  const stemRoleByWord = new Map();
  streamTable('word_form_lemmas', r => {
    const lk = lemmaKeyById.get(r.lemma_id);
    if (!lk) return;
    if (r.morpheme_role === 'stem' || !stemRoleByWord.has(r.word_id)) {
      wordToStemLemmaKey.set(r.word_id, lk);
      if (r.morpheme_role === 'stem') stemRoleByWord.set(r.word_id, true);
    }
  });

  const nodesByVerse = new Map();
  const crossVerseNodeById = new Map();
  streamTable('syntax_nodes', n => {
    if (!n.node_key?.startsWith('macula_tree:')) return;
    if (n.edition_id !== 11 && n.edition_id !== 18) return;
    const isClause = n.node_type === 'clause' ? 1 : 0;
    const rec = [n.id, n.parent_node_id || 0, isClause, n.is_cross_verse ? 1 : 0, n.terminal_word_id || 0];
    if (n.verse_id) {
      let arr = nodesByVerse.get(n.verse_id);
      if (!arr) { arr = []; nodesByVerse.set(n.verse_id, arr); }
      arr.push(rec);
    }
    if (n.is_cross_verse) crossVerseNodeById.set(n.id, rec);
  });

  function resolveVersePosToClause(verseId, wordIds) {
    const nodes = nodesByVerse.get(verseId);
    const posToClause = new Int32Array(wordIds.length + 1);
    if (!nodes || nodes.length === 0) return posToClause;
    nodes.sort((a, b) => a[0] - b[0]);
    const byId = new Map();
    for (const n of nodes) byId.set(n[0], n);
    const wPos = new Map();
    for (let i = 0; i < wordIds.length; i++) {
      const wid = wordIds[i];
      let arr = wPos.get(wid);
      if (!arr) { arr = []; wPos.set(wid, arr); }
      arr.push(i + 1);
    }
    const seen = new Map();
    let lastWid = 0, lastPos = 0;
    for (const n of nodes) {
      const wid = n[4];
      if (!wid) continue;
      let pos = lastPos;
      if (wid !== lastWid) {
        const occ = seen.get(wid) || 0;
        const arr = wPos.get(wid);
        pos = arr && occ < arr.length ? arr[occ] : 0;
        seen.set(wid, occ + 1);
        lastWid = wid;
        lastPos = pos;
      }
      if (!pos || posToClause[pos]) continue;
      let cur = n;
      let clauseId = 0;
      const visited = new Set();
      while (cur && !visited.has(cur[0])) {
        visited.add(cur[0]);
        if (cur[2] === 1) { clauseId = cur[0]; break; }
        const pid = cur[1];
        cur = pid ? (byId.get(pid) || crossVerseNodeById.get(pid) || null) : null;
      }
      posToClause[pos] = clauseId;
    }
    return posToClause;
  }

  // Pair key: `${l1}|${l2}` (lexicographically ordered) -> { clause: [...], colloc: [...] }
  const pairClauseSamples = new Map();
  const pairCollocSamples = new Map();
  for (const verse of versesList) {
    const wordIds = verse.word_ids || [];
    if (wordIds.length === 0) continue;
    const posToClause = resolveVersePosToClause(verse.id, wordIds);
    const lemmaPositions = new Map();
    for (let pos = 1; pos <= wordIds.length; pos++) {
      const lk = wordToStemLemmaKey.get(wordIds[pos - 1]);
      if (!lk) continue;
      if (!lemmaPositions.has(lk)) lemmaPositions.set(lk, []);
      lemmaPositions.get(lk).push(pos);
    }
    const distinctLemmas = [...lemmaPositions.keys()].sort();
    const refStr = `${USFM_BY_BOOK[verse.book] || `B${verse.book}`} ${verse.chapter}:${verse.verse_nr}`;
    for (let i = 0; i < distinctLemmas.length; i++) {
      const l1 = distinctLemmas[i];
      const posList1 = lemmaPositions.get(l1);
      const clauses1 = new Set();
      for (const p1 of posList1) {
        const c1 = posToClause[p1];
        if (c1 > 0) clauses1.add(c1);
      }
      if (clauses1.size === 0) continue;
      for (let j = i + 1; j < distinctLemmas.length; j++) {
        const l2 = distinctLemmas[j];
        const posList2 = lemmaPositions.get(l2);
        let inSameClause = false;
        for (const p2 of posList2) {
          const c2 = posToClause[p2];
          if (c2 > 0 && clauses1.has(c2)) { inSameClause = true; break; }
        }
        if (!inSameClause) continue;
        let isColloc = false;
        for (const p1 of posList1) {
          const c1 = posToClause[p1];
          if (c1 <= 0) continue;
          for (const p2 of posList2) {
            if (Math.abs(p1 - p2) <= 3 && posToClause[p2] === c1) {
              isColloc = true;
              break;
            }
          }
          if (isColloc) break;
        }
        const pk = `${l1}|${l2}`;
        const cArr = pairClauseSamples.get(pk);
        if (!cArr || cArr.length < 3) {
          const entry = {
            book: verse.book,
            chapter: verse.chapter,
            verse: verse.verse_nr,
            ref: refStr,
            in_same_clause: true,
            is_collocation: isColloc,
            near_verse_window: isColloc,
          };
          if (!cArr) pairClauseSamples.set(pk, [entry]);
          else cArr.push(entry);
        }
        if (isColloc) {
          const kArr = pairCollocSamples.get(pk);
          if (!kArr || kArr.length < 3) {
            const entry = {
              book: verse.book,
              chapter: verse.chapter,
              verse: verse.verse_nr,
              ref: refStr,
              in_same_clause: true,
              is_collocation: true,
              near_verse_window: true,
            };
            if (!kArr) pairCollocSamples.set(pk, [entry]);
            else kArr.push(entry);
          }
        }
      }
    }
  }
  nodesByVerse.clear();
  crossVerseNodeById.clear();
  console.log(`  Collected same_clause samples for ${pairClauseSamples.size} pairs, collocation samples for ${pairCollocSamples.size} pairs.`);

  function enrichContextualNeighbor(anchorLk, item) {
    const targetLk = item.target_lemma_key;
    const pk = anchorLk < targetLk ? `${anchorLk}|${targetLk}` : `${targetLk}|${anchorLk}`;
    const cSamples = pairClauseSamples.get(pk) || [];
    const kSamples = pairCollocSamples.get(pk) || [];
    const existing = item.sample_passages || [];
    const merged = [...existing];
    const seenRefs = new Set(existing.map(p => p.ref));
    for (const s of [...kSamples, ...cSamples]) {
      if (!seenRefs.has(s.ref)) {
        seenRefs.add(s.ref);
        merged.push(s);
      }
    }
    return {
      ...item,
      sample_passages: merged.slice(0, 7),
      ...(cSamples.length > 0 ? { same_clause_samples: cSamples } : {}),
      ...(kSamples.length > 0 ? { collocation_samples: kSamples } : {}),
    };
  }

  const r9bSrcCtx = path.join(OUT_BUNDLE, 'v2', 'relationships', 'r9b-v1.0', 'contextual');
  const r9bDst = path.join(OUT_BUNDLE, 'v2', 'relationships', 'r9b-v1.1');
  const r9bDstCtx = path.join(r9bDst, 'contextual');
  fs.rmSync(r9bDst, { recursive: true, force: true });
  fs.mkdirSync(path.join(r9bDstCtx, 'sharded-contextual'), { recursive: true });
  fs.mkdirSync(path.join(r9bDstCtx, 'pages'), { recursive: true });

  // Copy and enrich overflow pages first (reusing exact paths so overflow_pages references stay identical!)
  const pageDir = path.join(r9bSrcCtx, 'pages');
  for (const fname of fs.readdirSync(pageDir).filter(x => x.endsWith('.json.gz'))) {
    const pData = readGzJson(path.join(pageDir, fname));
    if (pData.entries) {
      for (const [lk, segs] of Object.entries(pData.entries)) {
        for (const seg of segs || []) {
          seg.items = (seg.items || []).map(it => enrichContextualNeighbor(lk, it));
        }
      }
    }
    writeGzJson(path.join(r9bDstCtx, 'pages', fname), pData);
  }

  // Copy and enrich 1024 sharded-contextual files
  const shardCtxDir = path.join(r9bSrcCtx, 'sharded-contextual');
  for (const fname of fs.readdirSync(shardCtxDir).filter(x => x.endsWith('.json.gz'))) {
    const sData = readGzJson(path.join(shardCtxDir, fname));
    for (const [lk, entry] of Object.entries(sData)) {
      if (entry && Array.isArray(entry.neighbors)) {
        entry.neighbors = entry.neighbors.map(it => enrichContextualNeighbor(lk, it));
      }
    }
    writeGzJson(path.join(r9bDstCtx, 'sharded-contextual', fname), sData);
  }

  // Write r9b-v1.1 manifests pointing grammatical -> r8-v1.2, contextual -> r9b-v1.1/contextual, preserving lexical/lxx/resolver
  for (const mName of ['manifest.json.gz', 'runtime-manifest.json.gz']) {
    const m = readGzJson(path.join(OUT_BUNDLE, 'v2', 'relationships', 'r9b-v1.0', mName));
    m.release_version = 'r9b-v1.1';
    m.previous_release = 'r9b-v1.0';
    m.layers.grammatical = {
      ...m.layers.grammatical,
      release_version: 'r8-v1.2',
      base_dir: '/v2/relationships/r8-v1.2',
      worker_shards: undefined,
    };
    delete m.layers.grammatical.worker_shards;
    m.layers.contextual = {
      ...m.layers.contextual,
      release_version: 'r9b-v1.1',
      base_dir: '/v2/relationships/r9b-v1.1/contextual',
    };
    writeGzJson(path.join(r9bDst, mName), m);
  }
  const r9bPlain = readGzJson(path.join(r9bDst, 'manifest.json.gz'));
  fs.writeFileSync(path.join(r9bDst, 'manifest.json'), JSON.stringify(r9bPlain, null, 2));

  if (!onlyContextual) {
  console.log('5/5 Cleaning Swete LXX chapter-heading Roman numerals in v1/lxx/...');
  const lxxDir = path.join(OUT_BUNDLE, 'v1', 'lxx');
  let lxxFixedTokens = 0;
  let lxxMarkedStandalone = 0;
  for (const fname of fs.readdirSync(lxxDir).filter(x => x.endsWith('.json.gz')).sort()) {
    const full = path.join(lxxDir, fname);
    const shard = readGzJson(full);
    const words = shard.words || [];
    let changed = false;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      const prev = i > 0 ? words[i - 1] : null;
      const next = i + 1 < words.length ? words[i + 1] : null;
      const rom = w.chapter >= 1 ? toRoman(w.chapter) : '';
      const romNext = w.chapter >= 1 ? toRoman(w.chapter + 1) : '';

      // Case A: Leading Roman chapter number on ch:1#1 preceded by matching Roman numeral at end of ch-1
      if (
        w.chapter >= 1 &&
        w.verse_nr === 1 &&
        w.ordinal === 1 &&
        rom &&
        w.word_text.startsWith(rom) &&
        w.word_text.length > rom.length &&
        /[\u0370-\u03FF\u1F00-\u1FFF]/.test(w.word_text[rom.length]) &&
        prev &&
        prev.chapter === w.chapter - 1 &&
        prev.word_text.endsWith(rom)
      ) {
        w.raw_source_word_text = w.word_text;
        w.chapter_heading_marker = rom;
        w.word_text = w.word_text.slice(rom.length);
        w.normalized_word = stripGreekDiacritics(w.word_text);
        lxxFixedTokens++;
        changed = true;
      }

      // Case B: Trailing Roman next-chapter number attached to last word of ch-1 (e.g. 1.8.22 καταIX)
      if (
        romNext &&
        w.word_text.endsWith(romNext) &&
        w.word_text.length > romNext.length &&
        /[\u0370-\u03FF\u1F00-\u1FFF]/.test(w.word_text[w.word_text.length - romNext.length - 1]) &&
        next &&
        next.chapter === w.chapter + 1 &&
        next.verse_nr === 1 &&
        (next.raw_source_word_text || next.word_text).startsWith(romNext)
      ) {
        w.raw_source_word_text = w.word_text;
        w.chapter_heading_marker = romNext;
        w.word_text = w.word_text.slice(0, w.word_text.length - romNext.length);
        w.normalized_word = stripGreekDiacritics(w.word_text);
        lxxFixedTokens++;
        changed = true;
      }

      // Case C: Standalone Roman chapter marker at chapter boundary
      if (
        (romNext && w.word_text === romNext && next && next.chapter === w.chapter + 1 && next.verse_nr === 1) ||
        (rom && w.word_text === rom && w.verse_nr === 1 && w.ordinal === 1 && prev && prev.chapter === w.chapter - 1)
      ) {
        w.raw_source_word_text = w.word_text;
        w.chapter_heading_marker = w.word_text;
        w.is_chapter_heading_marker = true;
        lxxMarkedStandalone++;
        changed = true;
      }
    }
    if (changed) writeGzJson(full, shard);
  }
  console.log(`  Swete LXX cleaned: ${lxxFixedTokens} prefixed/suffixed tokens, ${lxxMarkedStandalone} standalone markers.`);
  } // end !onlyContextual

  // Validate Cloudflare Free-plan limits
  const allFiles = walkFiles(OUT_BUNDLE);
  let maxFile = { rel: '', size: 0 };
  let totalBytes = 0;
  for (const f of allFiles) {
    totalBytes += f.size;
    if (f.size > maxFile.size) maxFile = f;
    assert.ok(f.size <= CF_MAX_FILE_BYTES, `Asset ${f.rel} exceeds 25 MiB (${f.size})`);
  }
  console.log(`\nStaging bundle summary: ${allFiles.length} / ${CF_MAX_ASSETS} files (${(totalBytes / (1024 * 1024)).toFixed(1)} MiB), largest=${maxFile.rel} (${(maxFile.size / (1024 * 1024)).toFixed(2)} MiB)`);
  if (allFiles.length > CF_MAX_ASSETS) {
    throw new Error(`Combined files ${allFiles.length} exceed Cloudflare ${CF_MAX_ASSETS} limit!`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
