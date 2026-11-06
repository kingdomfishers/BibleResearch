// scripts/import-syntax-trees.mjs
// Deterministic Syntax Tree ETL for Clear-Bible MACULA Hebrew & Greek Lowfat treebanks (F6-01)

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const envText = fs.readFileSync('.env', 'utf8');
const env = Object.fromEntries(
  envText
    .split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    })
);

const SUPABASE_URL = env.VITE_SUPABASE_URL || 'https://ejoperxiwxlcbsqrkrvb.supabase.co';
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_P7Pol8YPSsYOUFj77JSYgQ_og9E0H61';

const OSIS_BOOK_MAP = {
  GEN: 1, Gen: 1, EXO: 2, Exo: 2, LEV: 3, Lev: 3, NUM: 4, Num: 4, DEU: 5, Deu: 5,
  JOS: 6, Jos: 6, JDG: 7, Jdg: 7, RUT: 8, Rut: 8, '1SA': 9, '2SA': 10, '1KI': 11, '2KI': 12,
  '1CH': 13, '2CH': 14, EZR: 15, NEH: 16, EST: 17, JOB: 18, PSA: 19, Psa: 19, PRO: 20, Pro: 20,
  ECC: 21, Ecc: 21, SNG: 22, Sng: 22, ISA: 23, Isa: 23, JER: 24, Jer: 24, LAM: 25, Lam: 25,
  EZK: 26, Ezk: 26, DAN: 27, Dan: 27, HOS: 28, Hos: 28, JOL: 29, Jol: 29, AMO: 30, Amo: 30,
  OBA: 31, Oba: 31, JON: 32, Jon: 32, MIC: 33, Mic: 33, NAM: 34, Nam: 34, HAB: 35, Hab: 35,
  ZEP: 36, Zep: 36, HAG: 37, Hag: 37, ZEC: 38, Zec: 38, MAL: 39, Mal: 39,
  MAT: 40, Mat: 40, MRK: 41, Mrk: 41, LUK: 42, Luk: 42, JHN: 43, Jhn: 43, ACT: 44, Act: 44,
  ROM: 45, Rom: 45, '1CO': 46, '2CO': 47, GAL: 48, Gal: 48, EPH: 49, Eph: 49, PHP: 50, Php: 50,
  COL: 51, Col: 51, '1TH': 52, '2TH': 53, '1TI': 54, '2TI': 55, TIT: 56, Tit: 56, PHM: 57, Phm: 57,
  HEB: 58, Heb: 58, JAS: 59, Jas: 59, '1PE': 60, '2PE': 61, '1JN': 62, '1Jn': 62, '2JN': 63, '3JN': 64,
  JUD: 65, Jud: 65, REV: 66, Rev: 66,
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
    if (!res.ok) throw new Error(`Fetch ${tableAndFilter} failed: ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    all.push(...data);
    if (data.length < batchSize) break;
    offset += batchSize;
  }
  return all;
}

// Lowfat XML parser into nested DOM
function parseXmlTree(xml) {
  const tagRegex = /<(\/)?([a-zA-Z0-9_:]+)([^>]*?)(\/)?>|([^<]+)/g;
  let match;
  const root = { type: 'root', children: [] };
  const stack = [root];

  while ((match = tagRegex.exec(xml)) !== null) {
    const isClose = !!match[1];
    const tagName = match[2];
    const rawAttrs = match[3];
    const isSelfClose = !!match[4];
    const textContent = match[5];

    if (textContent) {
      const trimmed = textContent.trim();
      if (trimmed && stack.length > 0) {
        const top = stack[stack.length - 1];
        top.text = (top.text || '') + trimmed;
      }
      continue;
    }

    if (isClose) {
      if (stack.length > 1 && stack[stack.length - 1].tagName === tagName) {
        stack.pop();
      }
      continue;
    }

    const attrs = {};
    if (rawAttrs) {
      const attrRegex = /([a-zA-Z0-9_:-]+)="([^"]*)"/g;
      let aMatch;
      while ((aMatch = attrRegex.exec(rawAttrs)) !== null) {
        attrs[aMatch[1]] = aMatch[2];
      }
    }

    const node = {
      tagName,
      attrs,
      children: [],
    };

    stack[stack.length - 1].children.push(node);

    if (!isSelfClose && tagName !== 'milestone') {
      stack.push(node);
    }
  }

  return root;
}

// Convert DOM Sentence to normalized Syntax Nodes and Structural Edges
function convertTreeToNodesAndEdges(sentenceNode, treePrefix, editionId, sourceReleaseId, verseIdLookup, fallbackVerseId) {
  const nodes = [];
  const edges = [];
  let nodeCounter = 0;

  function traverse(domNode, parentNode, depth, siblingOrder) {
    nodeCounter++;
    const currentIdx = nodeCounter;
    const isTerminal = domNode.tagName === 'w';
    const isSentence = domNode.tagName === 'sentence';
    const isWg = domNode.tagName === 'wg';

    let nodeType = 'phrase';
    if (isSentence) nodeType = 'sentence';
    else if (isTerminal) nodeType = 'terminal';
    else if (isWg) nodeType = domNode.attrs.class === 'cl' ? 'clause' : 'phrase';

    const nodeKey = `${treePrefix}:${currentIdx}`;
    const role = domNode.attrs.role || (isSentence ? 'sentence' : null);
    const rule = domNode.attrs.rule || null;
    const cls = domNode.attrs.class || null;
    const cltype = domNode.attrs.cltype || null;
    const frame = domNode.attrs.frame || null;
    const xmlId = domNode.attrs['xml:id'] || null;

    // Resolve verse and word position
    let verseId = fallbackVerseId || 1;
    let wordPos = 1;
    if (domNode.attrs.ref) {
      const refParts = domNode.attrs.ref.split('!');
      const refVerse = refParts[0].trim();
      wordPos = parseInt(refParts[1], 10) || 1;
      if (verseIdLookup && verseIdLookup[refVerse]) {
        verseId = verseIdLookup[refVerse];
      }
    }

    const record = {
      node_key: nodeKey,
      parent_node_key: parentNode ? parentNode.node_key : null,
      tree_id: treePrefix,
      edition_id: editionId,
      verse_id: verseId,
      end_verse_id: verseId,
      node_type: nodeType,
      start_word_position: wordPos,
      end_word_position: wordPos,
      head_word_position: wordPos,
      syntactic_role: role,
      grammar_summary: rule,
      source_release_id: sourceReleaseId,
      source_record_id: xmlId || `${treePrefix}_wg_${currentIdx}`,
      depth: depth,
      sibling_order: siblingOrder,
      class_label: cls,
      rule_label: rule,
      cl_type: cltype,
      is_head: domNode.attrs.head === 'true',
      is_terminal: isTerminal,
      terminal_xml_id: xmlId,
      semantic_frame: frame,
      is_cross_verse: false,
    };

    nodes.push(record);

    if (parentNode) {
      let relType = 'parent_child';
      if (role) {
        const rLower = role.toLowerCase();
        if (['s', 'subj', 'subject'].includes(rLower)) relType = 'subject';
        else if (['o', 'obj', 'object'].includes(rLower)) relType = 'object';
        else if (['v', 'vc', 'pred', 'predicate'].includes(rLower)) relType = 'predicate';
        else if (['mod', 'adv', 'p', 'modifier'].includes(rLower)) relType = 'modifier';
        else if (['conj', 'coordinator'].includes(rLower)) relType = 'conjunction';
      }

      edges.push({
        source_node_key: parentNode.node_key,
        target_node_key: nodeKey,
        edition_id: editionId,
        verse_id: verseId,
        dependent_word_position: wordPos,
        head_word_position: parentNode.head_word_position || parentNode.start_word_position || wordPos,
        relation_type: relType,
        raw_relation_tag: role || rule || 'constituent',
        source_release_id: sourceReleaseId,
        source_record_id: `${parentNode.source_record_id}->${record.source_record_id}`,
      });
    }

    // Process children
    let sOrder = 0;
    const nonTextChildren = domNode.children.filter(c => c.tagName === 'wg' || c.tagName === 'w');
    for (const child of nonTextChildren) {
      traverse(child, record, depth + 1, sOrder++);
    }

    // Aggregate span from children
    if (nonTextChildren.length > 0) {
      const childRecords = nodes.filter(n => n.parent_node_key === nodeKey);
      if (childRecords.length > 0) {
        record.start_word_position = Math.min(...childRecords.map(c => c.start_word_position));
        record.end_word_position = Math.max(...childRecords.map(c => c.end_word_position));
        record.verse_id = Math.min(...childRecords.map(c => c.verse_id));
        record.end_verse_id = Math.max(...childRecords.map(c => c.end_verse_id));
        record.is_cross_verse = record.verse_id !== record.end_verse_id;
      }
    }

    return record;
  }

  traverse(sentenceNode, null, 0, 0);
  return { nodes, edges };
}

async function main() {
  console.log('=== Ingesting MACULA Hebrew & Greek Syntax Trees (F6-01) ===\n');

  // 1. Load canonical verse lookup
  console.log('1. Fetching canonical verse registry...');
  const verses = await postgrestSelectAll('verses?select=id,book,chapter,verse_nr');
  const verseLookup = {};
  const verseByBookChapterVerse = {};

  for (const v of verses) {
    verseByBookChapterVerse[`${v.book}:${v.chapter}:${v.verse_nr}`] = v.id;
  }

  // Populate OSIS lookups
  for (const [code, bNum] of Object.entries(OSIS_BOOK_MAP)) {
    for (const v of verses) {
      if (v.book === bNum) {
        verseLookup[`${code.toUpperCase()} ${v.chapter}:${v.verse_nr}`] = v.id;
        verseLookup[`${code} ${v.chapter}:${v.verse_nr}`] = v.id;
      }
    }
  }
  console.log(`  Loaded ${verses.length} canonical verses.\n`);

  // 2. Ingest MACULA Hebrew Lowfat Syntax Trees
  console.log('2. Ingesting MACULA Hebrew Syntax Trees (WLC)...');
  const hebrewFiles = [
    { file: '01-Gen-001-lowfat.xml', bookId: 1, chapter: 1, name: 'Genesis 1' },
    { file: '01-Gen-002-lowfat.xml', bookId: 1, chapter: 2, name: 'Genesis 2' },
    { file: '01-Gen-003-lowfat.xml', bookId: 1, chapter: 3, name: 'Genesis 3' },
    { file: '19-Psa-023-lowfat.xml', bookId: 19, chapter: 23, name: 'Psalm 23' },
    { file: '23-Isa-053-lowfat.xml', bookId: 23, chapter: 53, name: 'Isaiah 53' },
  ];

  const HEBREW_DIR = path.resolve('.artifacts/sources/macula-hebrew/WLC/lowfat');
  let totalHebrewNodes = 0;
  let totalHebrewEdges = 0;
  let totalHebrewSentences = 0;
  let totalHebrewClauses = 0;
  let totalHebrewPhrases = 0;
  let totalHebrewTerminals = 0;

  for (const hf of hebrewFiles) {
    const filePath = path.join(HEBREW_DIR, hf.file);
    if (!fs.existsSync(filePath)) {
      console.warn(`  Warning: File missing: ${filePath}`);
      continue;
    }

    const xml = fs.readFileSync(filePath, 'utf8');
    const parsed = parseXmlTree(xml);
    const chapterNode = parsed.children.find(c => c.tagName === 'chapter');
    if (!chapterNode) continue;

    const sentenceNodes = chapterNode.children.filter(c => c.tagName === 'sentence');
    let fileNodes = [];
    let fileEdges = [];
    let sIdx = 0;

    for (const sNode of sentenceNodes) {
      sIdx++;
      const sId = (sNode.attrs && sNode.attrs.id) ? sNode.attrs.id.replace(/\s+/g, '_') : `s_${sIdx}`;
      const treePrefix = `macula:wlc:${hf.bookId}:${hf.chapter}:${sId}`;
      const fallbackVerse = verseByBookChapterVerse[`${hf.bookId}:${hf.chapter}:${sIdx}`] || 1;

      const { nodes, edges } = convertTreeToNodesAndEdges(
        sNode,
        treePrefix,
        11, // edition_id 11 = macula-hebrew-wlc
        7,  // source_release_id 7 = macula-hebrew-47db250
        verseLookup,
        fallbackVerse
      );

      fileNodes.push(...nodes);
      fileEdges.push(...edges);

      totalHebrewSentences += nodes.filter(n => n.node_type === 'sentence').length;
      totalHebrewClauses += nodes.filter(n => n.node_type === 'clause').length;
      totalHebrewPhrases += nodes.filter(n => n.node_type === 'phrase').length;
      totalHebrewTerminals += nodes.filter(n => n.node_type === 'terminal').length;
    }

    // Batch RPC upload (batches of 300)
    for (let i = 0; i < fileNodes.length; i += 300) {
      const nodeChunk = fileNodes.slice(i, i + 300);
      const nodeKeySet = new Set(nodeChunk.map(n => n.node_key));
      const edgeChunk = fileEdges.filter(e => nodeKeySet.has(e.source_node_key));
      await rpcCall('ingest_syntax_tree_batch_v1', { p_nodes: nodeChunk, p_edges: edgeChunk });
      await new Promise(r => setTimeout(r, 20));
    }

    totalHebrewNodes += fileNodes.length;
    totalHebrewEdges += fileEdges.length;
    console.log(`  [Hebrew] Ingested ${hf.name}: ${fileNodes.length} nodes, ${fileEdges.length} edges.`);
  }

  console.log(`  Hebrew Ingestion Complete: ${totalHebrewNodes} nodes (${totalHebrewClauses} clauses, ${totalHebrewPhrases} phrases, ${totalHebrewTerminals} terminals).\n`);

  // 3. Ingest MACULA Greek Lowfat Syntax Trees
  console.log('3. Ingesting MACULA Greek Syntax Trees (Nestle 1904)...');
  const greekFiles = [
    { file: '04-john.xml', bookId: 43, osis: 'JHN', chapterFilter: [1], name: 'John 1' },
    { file: '06-romans.xml', bookId: 45, osis: 'ROM', chapterFilter: [3], name: 'Romans 3' },
    { file: '10-ephesians.xml', bookId: 49, osis: 'EPH', chapterFilter: [1], name: 'Ephesians 1 (Cross-Verse 1:3-14)' },
    { file: '01-matthew.xml', bookId: 40, osis: 'MAT', chapterFilter: [6], name: 'Matthew 6' },
    { file: '23-1john.xml', bookId: 62, osis: '1JN', chapterFilter: [5], name: '1 John 5' },
  ];

  const GREEK_DIR = path.resolve('.artifacts/sources/macula-greek/Nestle1904/lowfat');
  let totalGreekNodes = 0;
  let totalGreekEdges = 0;
  let totalGreekCrossVerse = 0;

  for (const gf of greekFiles) {
    const filePath = path.join(GREEK_DIR, gf.file);
    if (!fs.existsSync(filePath)) {
      console.warn(`  Warning: File missing: ${filePath}`);
      continue;
    }

    const xml = fs.readFileSync(filePath, 'utf8');
    const parsed = parseXmlTree(xml);
    const bookNode = parsed.children.find(c => c.tagName === 'book');
    if (!bookNode) continue;

    const sentenceNodes = bookNode.children.filter(c => c.tagName === 'sentence');
    let fileNodes = [];
    let fileEdges = [];
    let sIdx = 0;

    for (const sNode of sentenceNodes) {
      sIdx++;
      // Check which verses are referenced in this sentence
      const words = [];
      function collectWords(n) {
        if (n.tagName === 'w') words.push(n);
        for (const ch of n.children) collectWords(ch);
      }
      collectWords(sNode);

      if (words.length === 0) continue;

      // Extract chapter numbers from word refs e.g. "JHN 1:5!2"
      const chaptersInSentence = new Set();
      const versesInSentence = new Set();
      for (const w of words) {
        if (w.attrs.ref) {
          const cv = w.attrs.ref.split('!')[0]; // "JHN 1:5"
          const chNum = parseInt(cv.split(' ')[1].split(':')[0], 10);
          chaptersInSentence.add(chNum);
          versesInSentence.add(cv);
        }
      }

      // Filter to target chapters
      const matchesFilter = gf.chapterFilter.some(targetCh => chaptersInSentence.has(targetCh));
      if (!matchesFilter) continue;

      const firstRef = words[0].attrs.ref ? words[0].attrs.ref.split('!')[0] : `${gf.osis} 1:1`;
      const fallbackVerse = verseLookup[firstRef] || 26048;
      const sId = `s_${sIdx}_${firstRef.replace(/\s+/g, '_').replace(':', '_')}`;
      const treePrefix = `macula:nestle1904:${gf.bookId}:${sId}`;

      const { nodes, edges } = convertTreeToNodesAndEdges(
        sNode,
        treePrefix,
        18, // edition_id 18 = macula-greek-nestle1904
        8,  // source_release_id 8 = macula-greek-8423afe
        verseLookup,
        fallbackVerse
      );

      const crossVerseInTree = nodes.filter(n => n.is_cross_verse).length;
      if (crossVerseInTree > 0) totalGreekCrossVerse++;

      fileNodes.push(...nodes);
      fileEdges.push(...edges);
    }

    // Batch RPC upload (batches of 300)
    for (let i = 0; i < fileNodes.length; i += 300) {
      const nodeChunk = fileNodes.slice(i, i + 300);
      const nodeKeySet = new Set(nodeChunk.map(n => n.node_key));
      const edgeChunk = fileEdges.filter(e => nodeKeySet.has(e.source_node_key));
      await rpcCall('ingest_syntax_tree_batch_v1', { p_nodes: nodeChunk, p_edges: edgeChunk });
      await new Promise(r => setTimeout(r, 20));
    }

    totalGreekNodes += fileNodes.length;
    totalGreekEdges += fileEdges.length;
    console.log(`  [Greek] Ingested ${gf.name}: ${fileNodes.length} nodes, ${fileEdges.length} edges.`);
  }

  console.log(`  Greek Ingestion Complete: ${totalGreekNodes} nodes, ${totalGreekEdges} edges (${totalGreekCrossVerse} cross-verse sentences).\n`);

  console.log('======================================================');
  console.log(`TOTAL SYNTAX INGESTION: ${totalHebrewNodes + totalGreekNodes} nodes, ${totalHebrewEdges + totalGreekEdges} edges.`);
  console.log('======================================================');
}

main().catch(err => {
  console.error('Fatal ingestion error:', err);
  process.exit(1);
});
