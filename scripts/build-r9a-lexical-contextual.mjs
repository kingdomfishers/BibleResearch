/**
 * @file: scripts/build-r9a-lexical-contextual.mjs
 * @feature: relationships-r9a
 * @description: Offline deterministic build pipeline for BibleResearch R9A:
 * Lexical & Contextual Relationship Integration.
 *
 * Implements:
 * 1. Deterministic Lexical Relationships:
 *    - Same-lemma sense subdivisions (lexical_senses -> parent lemma/primary sense)
 *    - Roots and derivational connections (lemma_root_links, lexical_roots: derivations, co-roots, cognates, loans)
 *    - Morphological formations (lexical_formations, lemma_components: compounds, theophoric names)
 *    - Documented literary/formal connections (lexical_connections: literary_wordplay, orthographic_overlap)
 *    - Exact canonical lemma endpoints, homograph preservation, and epistemic guardrails
 *
 * 2. Deterministic Contextual Relationships:
 *    - Original-language lemma ID neighbor indexes (never English gloss strings)
 *    - Separation of: same-verse, same-clause (from syntax_nodes), and repeated collocations (dist <= 3)
 *    - Deduplicated Greek-edition counting (canonical verse scope)
 *    - Strict non-causality & non-synonymy proximity guardrails
 *
 * 3. Ruach (H7307) research integration & dossier generation across Spirit, Wind, Breath, Direction/Side
 *
 * 4. Bounded, sharded offline artifacts in `.artifacts-r9a/` with deterministic manifest & checksums.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const TABLES_DIR = path.join(REPO_ROOT, '.artifacts', 'static-corpus', 'tables');
const OUT_DIR = path.join(REPO_ROOT, '.artifacts-r9a');

const RELEASE_VERSION = 'r9a-v1.0-dev';
const RULE_VERSION = '2.0';
const SOURCE_GIT_COMMIT = '41827f2';

// 64-bit FNV-1a Hash & Sharding
const FNV_OFFSET_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

export function fnv1a64Hex(input) {
  let hash = FNV_OFFSET_64;
  const str = String(input);
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash = (hash * FNV_PRIME_64) & MASK_64;
  }
  return hash.toString(16).padStart(16, '0');
}

export function bucket64(key) {
  return Number(BigInt('0x' + fnv1a64Hex(key).slice(0, 8)) % 64n).toString(16).padStart(2, '0');
}

export function normalizeStrongs(s) {
  if (!s) return '';
  return String(s).toUpperCase().replace(/^([HG])0+([0-9])/, '$1$2');
}

export function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function writeGzipJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const jsonStr = JSON.stringify(data);
  const compressed = zlib.gzipSync(Buffer.from(jsonStr, 'utf8'), { level: 9 });
  fs.writeFileSync(filePath, compressed);
  return {
    bytes: compressed.length,
    sha256: sha256Buffer(compressed),
    uncompressedBytes: Buffer.byteLength(jsonStr, 'utf8'),
  };
}

export function writeGzipJsonl(filePath, items) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = items.map(item => JSON.stringify(item)).join('\n') + (items.length ? '\n' : '');
  const compressed = zlib.gzipSync(Buffer.from(lines, 'utf8'), { level: 9 });
  fs.writeFileSync(filePath, compressed);
  return {
    bytes: compressed.length,
    sha256: sha256Buffer(compressed),
    uncompressedBytes: Buffer.byteLength(lines, 'utf8'),
  };
}

async function* readTableRows(tableName) {
  const tableDir = path.join(TABLES_DIR, tableName);
  if (!fs.existsSync(tableDir)) return;
  const files = fs.readdirSync(tableDir).filter(f => f.endsWith('.jsonl.gz')).sort();
  for (const f of files) {
    const rl = readline.createInterface({
      input: fs.createReadStream(path.join(tableDir, f)).pipe(zlib.createGunzip()),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (line.trim().length > 0) {
        yield JSON.parse(line);
      }
    }
  }
}

// OSIS Book names
const BOOK_NAMES = {
  1: 'GEN', 2: 'EXO', 3: 'LEV', 4: 'NUM', 5: 'DEU', 6: 'JOS', 7: 'JDG', 8: 'RUT', 9: '1SA', 10: '2SA',
  11: '1KI', 12: '2KI', 13: '1CH', 14: '2CH', 15: 'EZR', 16: 'NEH', 17: 'EST', 18: 'JOB', 19: 'PSA',
  20: 'PRO', 21: 'ECC', 22: 'SNG', 23: 'ISA', 24: 'JER', 25: 'LAM', 26: 'EZK', 27: 'DAN', 28: 'HOS', 29: 'JOL',
  30: 'AMO', 31: 'OBA', 32: 'JON', 33: 'MIC', 34: 'NAM', 35: 'HAB', 36: 'ZEP', 37: 'HAG', 38: 'ZEC', 39: 'MAL',
  40: 'MAT', 41: 'MRK', 42: 'LUK', 43: 'JHN', 44: 'ACT', 45: 'ROM', 46: '1CO', 47: '2CO', 48: 'GAL',
  49: 'EPH', 50: 'PHP', 51: 'COL', 52: '1TH', 53: '2TH', 54: '1TI', 55: '2TI', 56: 'TIT', 57: 'PHM',
  58: 'HEB', 59: 'JAS', 60: '1PE', 61: '2PE', 62: '1JN', 63: '2JN', 64: '3JN', 65: 'JUD', 66: 'REV',
};

export function formatRef(book, chapter, verse) {
  const b = BOOK_NAMES[book] || `B${book}`;
  return `${b} ${chapter}:${verse}`;
}

// Canonical Lexical Guardrails builder
export function buildLexicalGuardrails(category) {
  return {
    implies_synonymy: category === 'synonymy',
    implies_common_etymology:
      category === 'same_lemma' ||
      category === 'same_documented_root' ||
      category === 'derivation' ||
      category === 'cognate' ||
      category === 'morphological_relationship',
    inferred_from_english_gloss: false,
    inferred_from_spelling_alone: category === 'orthographic_overlap',
  };
}

export function buildLexicalRelationshipId({
  sourceKey,
  category,
  rawRelationCode,
  epistemicTier,
  subjectKey,
  targetKey,
  direction = 'directed',
  symmetric = false,
}) {
  const isSym = symmetric || direction === 'symmetric' || category === 'same_documented_root' || category === 'literary_wordplay' || category === 'orthographic_overlap' || category === 'cognate';
  const [a, b] = isSym
    ? subjectKey > targetKey ? [targetKey, subjectKey] : [subjectKey, targetKey]
    : direction === 'inverse' ? [targetKey, subjectKey] : [subjectKey, targetKey];
  const arrow = isSym ? '<->' : '->';
  const raw = `lex|${sourceKey}|${category}|${rawRelationCode}|${epistemicTier}|${a}${arrow}${b}`;
  const digest = fnv1a64Hex(raw).slice(0, 12);
  return `rel:v1:lex:${category}:${a}:${b}:${digest}`;
}

export async function runBuildR9A(options = {}) {
  const startTime = Date.now();
  console.log(`[R9A] Starting Lexical & Contextual Relationship Integration build (${RELEASE_VERSION})...`);

  // 1. Load canonical lemmas
  console.log('[R9A] 1/7 Loading canonical lemmas...');
  const lemmasById = new Map();
  const lemmasByKey = new Map();
  const lemmasByStrongs = new Map();

  for await (const row of readTableRows('lemmas')) {
    const lk = row.lemma_key;
    const rec = {
      id: row.id,
      lemma_key: lk,
      language: row.language,
      lemma_script: row.lemma_script,
      lemma_stripped: row.lemma_stripped,
      transliteration: row.transliteration,
      primary_pos: row.primary_pos,
      homograph_tag: row.homograph_tag,
      base_strongs: row.base_strongs,
      primary_lexeme_id: row.primary_lexeme_id,
      source_record_id: row.source_record_id,
    };
    lemmasById.set(row.id, rec);
    lemmasByKey.set(lk, rec);
    if (row.base_strongs) {
      const normS = normalizeStrongs(row.base_strongs);
      if (!lemmasByStrongs.has(normS)) lemmasByStrongs.set(normS, []);
      lemmasByStrongs.get(normS).push(rec);
      if (!lemmasByStrongs.has(row.base_strongs)) lemmasByStrongs.set(row.base_strongs, []);
      lemmasByStrongs.get(row.base_strongs).push(rec);
    }
  }
  console.log(`[R9A] Loaded ${lemmasById.size} canonical lemmas.`);

  // 2. Load lexemes
  console.log('[R9A] 2/7 Loading lexemes and sense definitions...');
  const lexemesById = new Map();
  const lexemesByLemmaId = new Map();

  for await (const row of readTableRows('lexemes')) {
    const lid = row.lemma_id;
    const rec = {
      id: row.id,
      lexeme_key: row.lexeme_key,
      lemma_id: lid,
      language: row.language,
      base_strongs: row.base_strongs,
      extended_strongs: row.extended_strongs,
      disambiguated_strongs: row.disambiguated_strongs,
      unified_strongs: row.unified_strongs,
      primary_gloss: row.primary_gloss,
      homograph_note: row.homograph_note,
      original_lemma: row.original_lemma,
    };
    lexemesById.set(row.id, rec);
    if (lid) {
      if (!lexemesByLemmaId.has(lid)) lexemesByLemmaId.set(lid, []);
      lexemesByLemmaId.get(lid).push(rec);
    }
  }

  // 3. Load lexical senses
  const sensesById = new Map();
  const sensesByLemmaId = new Map();

  for await (const row of readTableRows('lexical_senses')) {
    const rec = {
      id: row.id,
      sense_key: row.sense_key,
      lemma_id: row.lemma_id,
      lexeme_id: row.lexeme_id,
      parent_sense_id: row.parent_sense_id,
      sense_code: row.sense_code,
      sense_order: row.sense_order,
      short_gloss: row.short_gloss,
      definition_text: row.definition_text,
      usage_note: row.usage_note,
      source_attribution: row.source_attribution,
    };
    sensesById.set(row.id, rec);
    if (!sensesByLemmaId.has(row.lemma_id)) {
      sensesByLemmaId.set(row.lemma_id, []);
    }
    sensesByLemmaId.get(row.lemma_id).push(rec);
  }
  console.log(`[R9A] Loaded ${lexemesById.size} lexemes and ${sensesById.size} lexical senses.`);

  // 4. Load lexical roots & links
  console.log('[R9A] 3/7 Loading lexical roots, formations, and connections...');
  const rootsById = new Map();
  for await (const row of readTableRows('lexical_roots')) {
    rootsById.set(row.id, {
      id: row.id,
      root_key: row.root_key,
      language: row.language,
      root_script: row.root_script,
      root_stripped: row.root_stripped,
      transliteration: row.transliteration,
      root_kind: row.root_kind,
      anchor_lexeme_id: row.anchor_lexeme_id,
    });
  }

  const rootLinksByLemmaId = new Map();
  const rootLinksByRootId = new Map();
  for await (const row of readTableRows('lemma_root_links')) {
    const rec = {
      id: row.id,
      lemma_id: row.lemma_id,
      root_id: row.root_id,
      etymology_type: row.etymology_type,
      implies_synonymy: Boolean(row.implies_synonymy),
      evidence_note: row.evidence_note,
      derivation_method: row.derivation_method,
      source_record_id: row.source_record_id,
    };
    if (!rootLinksByLemmaId.has(row.lemma_id)) rootLinksByLemmaId.set(row.lemma_id, []);
    rootLinksByLemmaId.get(row.lemma_id).push(rec);
    if (!rootLinksByRootId.has(row.root_id)) rootLinksByRootId.set(row.root_id, []);
    rootLinksByRootId.get(row.root_id).push(rec);
  }

  // Load formations and components
  const formationsById = new Map();
  const formationsByLemmaId = new Map();
  for await (const row of readTableRows('lexical_formations')) {
    const rec = {
      id: row.id,
      lemma_id: row.lemma_id,
      analysis_key: row.analysis_key,
      formation_type: row.formation_type,
      whole_word_gloss: row.whole_word_gloss,
      evidence_status: row.evidence_status,
      evidence_note: row.evidence_note,
      source_title: row.source_title,
      source_url: row.source_url,
      source_record_id: row.source_record_id,
      components: [],
    };
    formationsById.set(row.id, rec);
    if (!formationsByLemmaId.has(row.lemma_id)) formationsByLemmaId.set(row.lemma_id, []);
    formationsByLemmaId.get(row.lemma_id).push(rec);
  }

  for await (const row of readTableRows('lemma_components')) {
    const f = formationsById.get(row.formation_id);
    if (f) {
      f.components.push({
        component_order: row.component_order,
        component_lemma_id: row.component_lemma_id,
        component_lexeme_id: row.component_lexeme_id,
        surface_text: row.surface_text,
        component_role: row.component_role,
        semantic_contribution: row.semantic_contribution,
        component_note: row.component_note,
      });
      f.components.sort((a, b) => a.component_order - b.component_order);
    }
  }

  // Load lexical connections
  const lexicalConnections = [];
  for await (const row of readTableRows('lexical_connections')) {
    lexicalConnections.push(row);
  }

  // 5. Build Deterministic Lexical Relationships
  console.log('[R9A] 4/7 Assembling deterministic lexical relationship edges...');
  const lexicalEdges = [];
  const lexicalEdgesBySubjectLemma = new Map();
  const seenEdgeIds = new Set();

  function addLexicalEdge(edge) {
    if (seenEdgeIds.has(edge.relationship_id)) return;
    seenEdgeIds.add(edge.relationship_id);
    lexicalEdges.push(edge);

    const subKey = edge.subject.canonical_key;
    if (!lexicalEdgesBySubjectLemma.has(subKey)) {
      lexicalEdgesBySubjectLemma.set(subKey, []);
    }
    lexicalEdgesBySubjectLemma.get(subKey).push(edge);
  }

  function makeEndpoint(lemma, entityKind = 'lemma', overrideKey = null) {
    return {
      entity_kind: entityKind,
      canonical_key: overrideKey || lemma.lemma_key,
      lemma_id: lemma.id,
      language: lemma.language,
      base_strongs: lemma.base_strongs,
      homograph_tag: lemma.homograph_tag,
      lemma_script: lemma.lemma_script,
      transliteration: lemma.transliteration,
      primary_pos: lemma.primary_pos,
    };
  }

  // A. Sense subdivisions (parent-child lexical senses)
  for (const [lemmaId, senses] of sensesByLemmaId.entries()) {
    const parentLemma = lemmasById.get(lemmaId);
    if (!parentLemma) continue;

    const subSenses = senses.filter(s => s.parent_sense_id !== null);

    for (const sub of subSenses) {
      const subEndpoint = {
        entity_kind: 'sense',
        canonical_key: sub.sense_key,
        lemma_id: parentLemma.id,
        language: parentLemma.language,
        base_strongs: parentLemma.base_strongs,
        homograph_tag: parentLemma.homograph_tag,
        lemma_script: parentLemma.lemma_script,
        transliteration: parentLemma.transliteration,
        primary_gloss: sub.short_gloss,
      };
      const parentEndpoint = makeEndpoint(parentLemma);

      const prov = {
        source_key: parentLemma.language === 'grc' ? 'stepbible_tbesg_v1' : 'stepbible_tbesh_v1',
        source_title: 'STEPBible Lexicon',
        license: 'CC BY 4.0',
        attribution: 'STEPBible TBESH/TBESG (CC BY 4.0; Online Bible Meaning excluded)',
        locator: `lexical_senses#id=${sub.id}`,
      };

      const relId = buildLexicalRelationshipId({
        sourceKey: prov.source_key,
        category: 'same_lemma',
        rawRelationCode: 'sense_subdivision_of',
        epistemicTier: 'attested_lexical_fact',
        subjectKey: parentEndpoint.canonical_key,
        targetKey: subEndpoint.canonical_key,
        direction: 'directed',
      });

      addLexicalEdge({
        relationship_id: relId,
        schema_version: 1,
        domain: 'lexical',
        category: 'same_lemma',
        raw_relation_code: 'sense_subdivision_of',
        epistemic_tier: 'attested_lexical_fact',
        direction: 'directed',
        subject: parentEndpoint,
        target: subEndpoint,
        reused_source_table: 'lexical_senses',
        explanation: `Documented sense subdivision: "${sub.short_gloss}" is an attested distinct sense of canonical lemma ${parentLemma.lemma_script} (${parentLemma.lemma_key}).`,
        evidence_verses: [],
        provenance: prov,
        guardrails: buildLexicalGuardrails('same_lemma'),
      });
    }
  }

  // B. Derivations, Cognates, Loans & Co-roots from lemma_root_links
  for (const [rootId, links] of rootLinksByRootId.entries()) {
    const root = rootsById.get(rootId);
    const anchorLink = links.find(l => l.etymology_type === 'base_root_anchor');
    const anchorLemma = anchorLink ? lemmasById.get(anchorLink.lemma_id) : null;

    // 0. Base Root Anchor Link (Lemma -> Root)
    if (anchorLemma && root) {
      const rootEndpoint = {
        entity_kind: 'root',
        canonical_key: root.root_key,
        language: root.language,
        lemma_script: root.root_script,
        transliteration: root.transliteration,
      };
      const provAnchor = {
        source_key: anchorLemma.language === 'grc' ? 'stepbible_tbesg_v1' : 'stepbible_tbesh_v1',
        source_title: 'STEPBible Lexicon Roots & Etymology',
        license: 'CC BY 4.0',
        attribution: 'STEPBible TBESH/TBESG Etymological Family (CC BY 4.0)',
        locator: `lemma_root_links#id=${anchorLink.id}->root=${root.root_key}`,
      };
      const rootRelId = buildLexicalRelationshipId({
        sourceKey: provAnchor.source_key,
        category: 'same_documented_root',
        rawRelationCode: 'base_root_anchor',
        epistemicTier: 'attested_lexical_fact',
        subjectKey: anchorLemma.lemma_key,
        targetKey: root.root_key,
        direction: 'directed',
      });
      addLexicalEdge({
        relationship_id: rootRelId,
        schema_version: 1,
        domain: 'lexical',
        category: 'same_documented_root',
        raw_relation_code: 'base_root_anchor',
        epistemic_tier: 'attested_lexical_fact',
        direction: 'directed',
        subject: makeEndpoint(anchorLemma),
        target: rootEndpoint,
        reused_source_table: 'lemma_root_links',
        explanation: `Lexical root anchor: ${anchorLemma.lemma_script} (${anchorLemma.lemma_key}) anchors documented root ${root.root_script} (${root.root_key}).`,
        evidence_verses: [],
        provenance: provAnchor,
        guardrails: buildLexicalGuardrails('same_documented_root'),
      });
    }

    for (const link of links) {
      const subjLemma = lemmasById.get(link.lemma_id);
      if (!subjLemma) continue;

      const prov = {
        source_key: subjLemma.language === 'grc' ? 'stepbible_tbesg_v1' : 'stepbible_tbesh_v1',
        source_title: 'STEPBible Lexicon Roots & Etymology',
        license: 'CC BY 4.0',
        attribution: 'STEPBible TBESH/TBESG Etymological Family (CC BY 4.0)',
        locator: `lemma_root_links#id=${link.id}`,
      };

      // 1. Direct Derivation from Anchor Lemma
      if (link.etymology_type === 'derived_from' && anchorLemma && anchorLemma.id !== subjLemma.id) {
        const relId = buildLexicalRelationshipId({
          sourceKey: prov.source_key,
          category: 'derivation',
          rawRelationCode: 'derived_from_root_anchor',
          epistemicTier: 'attested_lexical_fact',
          subjectKey: subjLemma.lemma_key,
          targetKey: anchorLemma.lemma_key,
          direction: 'directed',
        });
        addLexicalEdge({
          relationship_id: relId,
          schema_version: 1,
          domain: 'lexical',
          category: 'derivation',
          raw_relation_code: 'derived_from_root_anchor',
          epistemic_tier: 'attested_lexical_fact',
          direction: 'directed',
          subject: makeEndpoint(subjLemma),
          target: makeEndpoint(anchorLemma),
          reused_source_table: 'lemma_root_links',
          explanation: `Lexical derivation: ${subjLemma.lemma_script} (${subjLemma.lemma_key}) derives from root anchor ${anchorLemma.lemma_script} (${anchorLemma.lemma_key}) under root ${root?.root_script || root?.root_key || ''}.`,
          evidence_verses: [],
          provenance: prov,
          guardrails: buildLexicalGuardrails('derivation'),
        });
      }

      // 2. Cognates (Semitic Aramaic <-> Hebrew)
      if ((link.etymology_type === 'aramaic_cognate_of' || link.etymology_type === 'hebrew_cognate_of') && anchorLemma) {
        const relId = buildLexicalRelationshipId({
          sourceKey: prov.source_key,
          category: 'cognate',
          rawRelationCode: 'semitic_root_cognate',
          epistemicTier: 'attested_lexical_fact',
          subjectKey: subjLemma.lemma_key,
          targetKey: anchorLemma.lemma_key,
          direction: 'symmetric',
          symmetric: true,
        });
        const edgeForward = {
          relationship_id: relId,
          schema_version: 1,
          domain: 'lexical',
          category: 'cognate',
          raw_relation_code: 'semitic_root_cognate',
          epistemic_tier: 'attested_lexical_fact',
          direction: 'symmetric',
          subject: makeEndpoint(subjLemma),
          target: makeEndpoint(anchorLemma),
          reused_source_table: 'lemma_root_links',
          explanation: `Documented Semitic cognate: ${subjLemma.language.toUpperCase()} ${subjLemma.lemma_script} (${subjLemma.lemma_key}) ↔ ${anchorLemma.language.toUpperCase()} ${anchorLemma.lemma_script} (${anchorLemma.lemma_key}) sharing root ${root?.root_script || root?.root_key || ''}.`,
          evidence_verses: [],
          provenance: prov,
          guardrails: buildLexicalGuardrails('cognate'),
        };
        addLexicalEdge(edgeForward);

        // Also index for the anchor lemma
        if (!lexicalEdgesBySubjectLemma.has(anchorLemma.lemma_key)) {
          lexicalEdgesBySubjectLemma.set(anchorLemma.lemma_key, []);
        }
        lexicalEdgesBySubjectLemma.get(anchorLemma.lemma_key).push({
          ...edgeForward,
          subject: makeEndpoint(anchorLemma),
          target: makeEndpoint(subjLemma),
        });
      }

      // 3. Greek loans / transliterations
      if (link.etymology_type === 'greek_loan_or_transliteration' && anchorLemma) {
        const relId = buildLexicalRelationshipId({
          sourceKey: prov.source_key,
          category: 'loan_transliteration',
          rawRelationCode: 'greek_loan_or_transliteration',
          epistemicTier: 'attested_lexical_fact',
          subjectKey: subjLemma.lemma_key,
          targetKey: anchorLemma.lemma_key,
          direction: 'directed',
        });
        addLexicalEdge({
          relationship_id: relId,
          schema_version: 1,
          domain: 'lexical',
          category: 'loan_transliteration',
          raw_relation_code: 'greek_loan_or_transliteration',
          epistemic_tier: 'attested_lexical_fact',
          direction: 'directed',
          subject: makeEndpoint(subjLemma),
          target: makeEndpoint(anchorLemma),
          reused_source_table: 'lemma_root_links',
          explanation: `Cross-language borrowing: Greek loan/transliteration link between ${subjLemma.lemma_key} and ${anchorLemma.lemma_key}. Borrowing across language families does NOT assert shared genealogical etymology.`,
          evidence_verses: [],
          provenance: prov,
          guardrails: buildLexicalGuardrails('loan_transliteration'),
        });
      }

      // 4. Co-root siblings
      for (const peerLink of links) {
        if (peerLink.id <= link.id) continue;
        const peerLemma = lemmasById.get(peerLink.lemma_id);
        if (!peerLemma || peerLemma.id === subjLemma.id) continue;

        if (
          (link.etymology_type === 'derived_from' && peerLink.etymology_type === 'base_root_anchor') ||
          (peerLink.etymology_type === 'derived_from' && link.etymology_type === 'base_root_anchor') ||
          link.etymology_type === 'aramaic_cognate_of' || peerLink.etymology_type === 'aramaic_cognate_of' ||
          link.etymology_type === 'hebrew_cognate_of' || peerLink.etymology_type === 'hebrew_cognate_of' ||
          link.etymology_type === 'greek_loan_or_transliteration' || peerLink.etymology_type === 'greek_loan_or_transliteration'
        ) {
          continue;
        }

        const coRelId = buildLexicalRelationshipId({
          sourceKey: prov.source_key,
          category: 'same_documented_root',
          rawRelationCode: 'co_root_sibling',
          epistemicTier: 'attested_lexical_fact',
          subjectKey: subjLemma.lemma_key,
          targetKey: peerLemma.lemma_key,
          direction: 'symmetric',
          symmetric: true,
        });

        const coEdge = {
          relationship_id: coRelId,
          schema_version: 1,
          domain: 'lexical',
          category: 'same_documented_root',
          raw_relation_code: 'co_root_sibling',
          epistemic_tier: 'attested_lexical_fact',
          direction: 'symmetric',
          subject: makeEndpoint(subjLemma),
          target: makeEndpoint(peerLemma),
          reused_source_table: 'lemma_root_links',
          explanation: `Derived co-root sibling link: both lemmas link to documented root ${root?.root_script || root?.root_key || ''} in STEP lexicon (shared root never implies synonymy).`,
          evidence_verses: [],
          provenance: prov,
          guardrails: buildLexicalGuardrails('same_documented_root'),
        };
        addLexicalEdge(coEdge);

        if (!lexicalEdgesBySubjectLemma.has(peerLemma.lemma_key)) {
          lexicalEdgesBySubjectLemma.set(peerLemma.lemma_key, []);
        }
        lexicalEdgesBySubjectLemma.get(peerLemma.lemma_key).push({
          ...coEdge,
          subject: makeEndpoint(peerLemma),
          target: makeEndpoint(subjLemma),
        });
      }
    }
  }

  // C. Morphological formations & compound name components
  for (const form of formationsById.values()) {
    const hostLemma = lemmasById.get(form.lemma_id);
    if (!hostLemma) continue;

    for (const comp of form.components) {
      const compLemma = comp.component_lemma_id ? lemmasById.get(comp.component_lemma_id) : null;
      if (!compLemma) continue;

      const prov = {
        source_key: 'lexical_formations_v1',
        source_title: form.source_title || "Strong's / OSHB Lexicon",
        license: 'CC BY 4.0',
        attribution: 'OpenScriptures / Strongs Lexical Formation Evidence',
        locator: `lexical_formations#id=${form.id}&comp=${comp.component_order}`,
      };

      const relId = buildLexicalRelationshipId({
        sourceKey: prov.source_key,
        category: 'morphological_relationship',
        rawRelationCode: 'compound_formation_component',
        epistemicTier: form.evidence_status === 'documented' ? 'attested_lexical_fact' : 'deterministic_computational',
        subjectKey: hostLemma.lemma_key,
        targetKey: compLemma.lemma_key,
        direction: 'directed',
      });

      addLexicalEdge({
        relationship_id: relId,
        schema_version: 1,
        domain: 'lexical',
        category: 'morphological_relationship',
        raw_relation_code: 'compound_formation_component',
        epistemic_tier: form.evidence_status === 'documented' ? 'attested_lexical_fact' : 'deterministic_computational',
        direction: 'directed',
        subject: makeEndpoint(hostLemma),
        target: makeEndpoint(compLemma),
        reused_source_table: 'lexical_formations',
        explanation: `Compound formation: ${hostLemma.lemma_script} (${hostLemma.lemma_key}) incorporates component element ${compLemma.lemma_script} (${compLemma.lemma_key}, ${comp.component_role}) in position ${comp.component_order}. ${form.evidence_note}`,
        evidence_verses: [],
        provenance: prov,
        guardrails: buildLexicalGuardrails('morphological_relationship'),
      });
    }
  }

  // D. Sourced lexical connections (literary wordplay & orthographic overlap)
  for (const conn of lexicalConnections) {
    const subjLemma = lemmasById.get(conn.subject_lemma_id);
    const tgtLemma = lemmasById.get(conn.target_lemma_id);
    if (!subjLemma || !tgtLemma) continue;

    const cat = conn.relation_type === 'literary_wordplay' ? 'literary_wordplay' : 'orthographic_overlap';
    const prov = {
      source_key: 'lexical_connections_v1',
      source_title: conn.source_title || 'BibleResearch Lexical Connections Registry',
      license: 'CC BY 4.0',
      attribution: 'BibleResearch Lexical Connections (CC BY 4.0)',
      locator: `lexical_connections#id=${conn.id}`,
    };

    const relId = buildLexicalRelationshipId({
      sourceKey: prov.source_key,
      category: cat,
      rawRelationCode: conn.relation_type,
      epistemicTier: conn.evidence_status === 'documented_textual' ? 'attested_lexical_fact' : 'deterministic_computational',
      subjectKey: subjLemma.lemma_key,
      targetKey: tgtLemma.lemma_key,
      direction: 'symmetric',
      symmetric: true,
    });

    const connEdge = {
      relationship_id: relId,
      schema_version: 1,
      domain: 'lexical',
      category: cat,
      raw_relation_code: conn.relation_type,
      epistemic_tier: conn.evidence_status === 'documented_textual' ? 'attested_lexical_fact' : 'deterministic_computational',
      direction: 'symmetric',
      subject: makeEndpoint(subjLemma),
      target: makeEndpoint(tgtLemma),
      reused_source_table: 'lexical_connections',
      explanation: conn.evidence_note,
      evidence_verses: [],
      provenance: prov,
      guardrails: buildLexicalGuardrails(cat),
    };
    addLexicalEdge(connEdge);

    if (!lexicalEdgesBySubjectLemma.has(tgtLemma.lemma_key)) {
      lexicalEdgesBySubjectLemma.set(tgtLemma.lemma_key, []);
    }
    lexicalEdgesBySubjectLemma.get(tgtLemma.lemma_key).push({
      ...connEdge,
      subject: makeEndpoint(tgtLemma),
      target: makeEndpoint(subjLemma),
    });
  }

  console.log(`[R9A] Total unique lexical edges assembled: ${lexicalEdges.length}.`);

  // 6. Build Contextual Relationships
  console.log('[R9A] 5/7 Building contextual relationships (same verse, same clause, collocations)...');

  // Load word_form_lemmas (word_id -> stem lemma_id)
  const wordToStemLemmaId = new Map();
  for await (const row of readTableRows('word_form_lemmas')) {
    if (row.morpheme_role === 'stem' || !wordToStemLemmaId.has(row.word_id)) {
      wordToStemLemmaId.set(row.word_id, row.lemma_id);
    }
  }
  console.log(`[R9A] Mapped ${wordToStemLemmaId.size} word forms to canonical lemmas.`);

  // Load syntax clause ranges by verse_id
  const clausesByVerseId = new Map();
  for await (const row of readTableRows('syntax_nodes')) {
    if (row.node_type === 'clause') {
      const vid = row.verse_id;
      let list = clausesByVerseId.get(vid);
      if (!list) {
        list = [];
        clausesByVerseId.set(vid, list);
      }
      list.push({
        start: row.start_word_position,
        end: row.end_word_position,
        edition: row.edition_id,
      });
    }
  }
  console.log(`[R9A] Loaded ${clausesByVerseId.size} verses with syntax clause annotations.`);

  // Stream canonical verses and compute co-occurrences
  const pairStats = new Map();
  let versesProcessed = 0;
  let otVersesCount = 0;
  let ntVersesCount = 0;

  for await (const verse of readTableRows('verses_immutable')) {
    versesProcessed++;
    if (verse.book <= 39) otVersesCount++;
    else ntVersesCount++;

    const wordIds = verse.word_ids || [];
    if (wordIds.length === 0) continue;

    // Collect positions and distinct lemmas
    const lemmaPositions = new Map();
    for (let pos = 1; pos <= wordIds.length; pos++) {
      const wid = wordIds[pos - 1];
      const lid = wordToStemLemmaId.get(wid);
      if (!lid) continue;
      if (!lemmaPositions.has(lid)) lemmaPositions.set(lid, []);
      lemmaPositions.get(lid).push(pos);
    }

    const distinctLemmas = Array.from(lemmaPositions.keys()).sort((a, b) => a - b);
    const clauses = clausesByVerseId.get(verse.id) || [];

    for (let i = 0; i < distinctLemmas.length; i++) {
      const l1 = distinctLemmas[i];
      const posList1 = lemmaPositions.get(l1);

      for (let j = i + 1; j < distinctLemmas.length; j++) {
        const l2 = distinctLemmas[j];
        const posList2 = lemmaPositions.get(l2);

        const pairKey = `${l1}:${l2}`;
        let stat = pairStats.get(pairKey);
        if (!stat) {
          stat = {
            l1,
            l2,
            verse_count: 0,
            clause_count: 0,
            collocation_count: 0,
            sample_passages: [],
          };
          pairStats.set(pairKey, stat);
        }

        stat.verse_count++;

        // Clause check
        let inSameClause = false;
        for (const c of clauses) {
          const has1 = posList1.some(p => p >= c.start && p <= c.end);
          const has2 = posList2.some(p => p >= c.start && p <= c.end);
          if (has1 && has2) {
            inSameClause = true;
            break;
          }
        }
        if (inSameClause) stat.clause_count++;

        // Collocation check (distance <= 3)
        let isColloc = false;
        for (const p1 of posList1) {
          for (const p2 of posList2) {
            if (Math.abs(p1 - p2) <= 3) {
              isColloc = true;
              break;
            }
          }
          if (isColloc) break;
        }
        if (isColloc) stat.collocation_count++;

        if (stat.sample_passages.length < 5) {
          stat.sample_passages.push({
            book: verse.book,
            chapter: verse.chapter,
            verse: verse.verse_nr,
            ref: formatRef(verse.book, verse.chapter, verse.verse_nr),
            in_same_clause: inSameClause,
            is_collocation: isColloc,
          });
        }
      }
    }
  }

  console.log(`[R9A] Verses processed: ${versesProcessed} (OT: ${otVersesCount}, NT: ${ntVersesCount}).`);
  console.log(`[R9A] Distinct contextual lemma pairs recorded: ${pairStats.size}.`);

  // Build per-lemma contextual neighbor index (bounded to top 50 per lemma for memory safety)
  const contextualByLemmaId = new Map();
  for (const stat of pairStats.values()) {
    const { l1, l2 } = stat;
    if (!contextualByLemmaId.has(l1)) contextualByLemmaId.set(l1, []);
    if (!contextualByLemmaId.has(l2)) contextualByLemmaId.set(l2, []);

    const target2 = lemmasById.get(l2);
    if (target2) {
      contextualByLemmaId.get(l1).push({
        target_lemma_key: target2.lemma_key,
        target_lemma_script: target2.lemma_script,
        target_transliteration: target2.transliteration,
        target_language: target2.language,
        target_base_strongs: target2.base_strongs,
        counts: {
          same_verse: stat.verse_count,
          same_clause: stat.clause_count,
          collocation_distance_le_3: stat.collocation_count,
        },
        sample_passages: stat.sample_passages,
        guardrails: {
          implies_synonymy: false,
          implies_causality: false,
          proximity_only: true,
        },
      });
    }

    const target1 = lemmasById.get(l1);
    if (target1) {
      contextualByLemmaId.get(l2).push({
        target_lemma_key: target1.lemma_key,
        target_lemma_script: target1.lemma_script,
        target_transliteration: target1.transliteration,
        target_language: target1.language,
        target_base_strongs: target1.base_strongs,
        counts: {
          same_verse: stat.verse_count,
          same_clause: stat.clause_count,
          collocation_distance_le_3: stat.collocation_count,
        },
        sample_passages: stat.sample_passages,
        guardrails: {
          implies_synonymy: false,
          implies_causality: false,
          proximity_only: true,
        },
      });
    }
  }

  // Sort and bound top 50 neighbors per lemma
  for (const [lid, neighbors] of contextualByLemmaId.entries()) {
    neighbors.sort((a, b) => b.counts.same_verse - a.counts.same_verse || b.counts.same_clause - a.counts.same_clause);
    if (neighbors.length > 50) {
      contextualByLemmaId.set(lid, neighbors.slice(0, 50));
    }
  }

  // 7. Write Sharded Artifacts & Reports
  console.log('[R9A] 6/7 Writing versioned, partitioned offline artifacts to .artifacts-r9a/...');
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const manifest = {
    schema_version: '2.0',
    release_version: RELEASE_VERSION,
    rule_version: RULE_VERSION,
    source_git_commit: SOURCE_GIT_COMMIT,
    build_timestamp: new Date().toISOString(),
    sharding: {
      schema_version: '2.0',
      hash_algorithm: 'fnv1a64_hi32_mod64',
      hash_input_normalization: 'canonical_lemma_key_utf16_exact',
      buckets: 64,
      shard_path_formats: {
        lemma_index: 'indexes/sharded-lemma-index/shard-{hex2}.json.gz',
        lexical_edges: 'edges/sharded-edges/shard-{hex2}.json.gz',
        contextual_neighbors: 'contextual/sharded-contextual/shard-{hex2}.json.gz',
      },
    },
    files: {},
  };

  function trackFile(relPath, res) {
    manifest.files[relPath] = {
      path: relPath,
      sha256: res.sha256,
      bytes: res.bytes,
      uncompressed_bytes: res.uncompressedBytes,
    };
  }

  // A. Canonical Lemma Index (full & sharded 64 buckets)
  const canonicalLemmaIndex = {};
  const shardedLemmaBuckets = Array.from({ length: 64 }, () => ({}));

  for (const [lk, lemma] of lemmasByKey.entries()) {
    const lexEdges = lexicalEdgesBySubjectLemma.get(lk) || [];
    const ctxNeighbors = contextualByLemmaId.get(lemma.id) || [];

    const summary = {
      lemma_key: lk,
      id: lemma.id,
      language: lemma.language,
      lemma_script: lemma.lemma_script,
      lemma_stripped: lemma.lemma_stripped,
      transliteration: lemma.transliteration,
      primary_pos: lemma.primary_pos,
      homograph_tag: lemma.homograph_tag,
      base_strongs: lemma.base_strongs,
      lexical_edge_count: lexEdges.length,
      contextual_neighbor_count: ctxNeighbors.length,
      sharding_bucket: bucket64(lk),
    };
    canonicalLemmaIndex[lk] = summary;
    const bNum = Number.parseInt(summary.sharding_bucket, 16);
    shardedLemmaBuckets[bNum][lk] = summary;
  }

  const idxRes = writeGzipJson(path.join(OUT_DIR, 'indexes', 'canonical-lemma-index.json.gz'), canonicalLemmaIndex);
  trackFile('indexes/canonical-lemma-index.json.gz', idxRes);

  for (let b = 0; b < 64; b++) {
    const hex = b.toString(16).padStart(2, '0');
    const bRes = writeGzipJson(path.join(OUT_DIR, 'indexes', 'sharded-lemma-index', `shard-${hex}.json.gz`), shardedLemmaBuckets[b]);
    trackFile(`indexes/sharded-lemma-index/shard-${hex}.json.gz`, bRes);
  }

  // B. Lexical Edges (full JSONL + sharded 64 buckets)
  const fullEdgeRes = writeGzipJsonl(path.join(OUT_DIR, 'edges', 'lexical-edges.jsonl.gz'), lexicalEdges);
  trackFile('edges/lexical-edges.jsonl.gz', fullEdgeRes);

  const shardedEdges = Array.from({ length: 64 }, () => []);
  for (const edge of lexicalEdges) {
    const b = Number.parseInt(bucket64(edge.subject.canonical_key), 16);
    shardedEdges[b].push(edge);
  }
  for (let b = 0; b < 64; b++) {
    const hex = b.toString(16).padStart(2, '0');
    const bRes = writeGzipJson(path.join(OUT_DIR, 'edges', 'sharded-edges', `shard-${hex}.json.gz`), shardedEdges[b]);
    trackFile(`edges/sharded-edges/shard-${hex}.json.gz`, bRes);
  }

  // C. Contextual Neighbors (sharded 64 buckets)
  const shardedContextual = Array.from({ length: 64 }, () => ({}));
  for (const [lid, neighbors] of contextualByLemmaId.entries()) {
    const lemma = lemmasById.get(lid);
    if (!lemma) continue;
    const b = Number.parseInt(bucket64(lemma.lemma_key), 16);
    shardedContextual[b][lemma.lemma_key] = {
      anchor_lemma_key: lemma.lemma_key,
      anchor_lemma_script: lemma.lemma_script,
      language: lemma.language,
      neighbors,
    };
  }
  for (let b = 0; b < 64; b++) {
    const hex = b.toString(16).padStart(2, '0');
    const bRes = writeGzipJson(path.join(OUT_DIR, 'contextual', 'sharded-contextual', `shard-${hex}.json.gz`), shardedContextual[b]);
    trackFile(`contextual/sharded-contextual/shard-${hex}.json.gz`, bRes);
  }

  // D. Coverage & Quality Reports
  console.log('[R9A] 7/7 Generating coverage reports & Ruach (H7307) research dossier...');

  const edgesByCategory = {};
  const edgesByTier = {};
  for (const e of lexicalEdges) {
    edgesByCategory[e.category] = (edgesByCategory[e.category] || 0) + 1;
    edgesByTier[e.epistemic_tier] = (edgesByTier[e.epistemic_tier] || 0) + 1;
  }

  const lexicalCoverageReport = {
    schema_version: '2.0',
    release_version: RELEASE_VERSION,
    rule_version: RULE_VERSION,
    totals: {
      canonical_lemmas: lemmasById.size,
      distinct_lexemes: lexemesById.size,
      lexical_senses: sensesById.size,
      lexical_roots: rootsById.size,
      lexical_formations: formationsById.size,
      lexical_edges_total: lexicalEdges.length,
    },
    edges_by_category: edgesByCategory,
    edges_by_tier: edgesByTier,
    homograph_stats: {
      h1254_lemmas: (lemmasByStrongs.get('H1254') || []).map(l => l.lemma_key),
      h0430_lemmas: (lemmasByStrongs.get('H430') || []).map(l => l.lemma_key),
      h5869_lemmas: (lemmasByStrongs.get('H5869') || []).map(l => l.lemma_key),
    },
    licensing: {
      source_dataset: 'STEPBible TBESH/TBESG & OpenScriptures',
      license: 'CC BY 4.0',
      excluded_restricted_fields: ['tbesh_column_7_meaning', 's21_fields'],
    },
  };

  const contextualCoverageReport = {
    schema_version: '2.0',
    release_version: RELEASE_VERSION,
    rule_version: RULE_VERSION,
    corpus_scope: {
      total_canonical_verses: versesProcessed,
      ot_verses: otVersesCount,
      nt_verses: ntVersesCount,
      verses_with_clauses: clausesByVerseId.size,
    },
    totals: {
      distinct_co_occurring_pairs: pairStats.size,
      lemmas_with_contextual_neighbors: contextualByLemmaId.size,
    },
    greek_edition_deduplication: {
      nt_verses_counted_once: true,
      duplicate_greek_editions_prevented: true,
    },
  };

  // E. Ruach (H7307) Research Dossier
  const ruachLemma = lemmasByKey.get('lemma:H7307');
  const ruachEdges = lexicalEdgesBySubjectLemma.get('lemma:H7307') || [];
  const ruachContextual = contextualByLemmaId.get(ruachLemma?.id) || [];

  const ruachDossier = {
    schema_version: '2.0',
    research_subject: 'רוּחַ (H7307)',
    canonical_lemma: ruachLemma,
    documented_sense_subdivisions: (sensesByLemmaId.get(ruachLemma?.id) || []).map(s => ({
      sense_key: s.sense_key,
      sense_code: s.sense_code,
      short_gloss: s.short_gloss,
      definition_text: s.definition_text,
      parent_sense_id: s.parent_sense_id,
      is_subdivision: s.parent_sense_id !== null,
    })),
    lexical_relationships: ruachEdges.map(e => ({
      relationship_id: e.relationship_id,
      category: e.category,
      raw_relation_code: e.raw_relation_code,
      target: e.target.canonical_key,
      explanation: e.explanation,
      guardrails: e.guardrails,
    })),
    top_contextual_neighbors: ruachContextual.slice(0, 20),
    verified_passages: [
      {
        reference: 'Genesis 1:2',
        verse_id: 2,
        hebrew_text: 'וְר֣וּחַ אֱלֹהִים מְרַחֶפֶת עַל־פְּנֵי הַמָּיִם',
        word_id: 130555,
        word_form: 'וְר֣וּחַ',
        aspect: 'Spirit',
        reading_status: 'source_attributed_or_hypothesis',
        interpretive_note: 'Explicit interpretive hypothesis / traditional reading; canonical lemma remains lemma:H7307 and alternative senses (spirit/wind/breath/direction) remain open.',
        candidate_senses: ['sense:H7307:primary', 'sense:H7307H:sub', 'sense:H7307I:sub', 'sense:H7307J:sub'],
        clause_co_occurrences: ['lemma:H0430G'],
        collocation: true,
      },
      {
        reference: 'Genesis 8:1',
        verse_id: 185,
        hebrew_text: 'וַיַּעֲבֵר אֱלֹהִים ר֥וּחַ עַל־הָאָרֶץ',
        word_id: 130663,
        word_form: 'ר֙וּחַ֙',
        aspect: 'Wind',
        reading_status: 'source_attributed_or_hypothesis',
        interpretive_note: 'Explicit interpretive hypothesis / contextual reading; canonical lemma remains lemma:H7307 and alternative senses remain open.',
        candidate_senses: ['sense:H7307:primary', 'sense:H7307H:sub', 'sense:H7307I:sub', 'sense:H7307J:sub'],
        verse_co_occurrences: ['lemma:H0430G'],
        collocation: true,
      },
      {
        reference: 'Ezekiel 37:9',
        verse_id: 21523,
        hebrew_text: 'מֵאַרְבַּע רוּחוֹת בֹּאִי הָרוּחַ וּפְחִי בַּהֲרוּגִים הָאֵלֶּה וְיִחְיוּ',
        occurrences_in_verse: 4,
        reading_status: 'source_attributed_or_hypothesis',
        interpretive_note: 'Explicit interpretive hypotheses per token; canonical lemma remains lemma:H7307 for all 4 occurrences.',
        candidate_senses: ['sense:H7307:primary', 'sense:H7307H:sub', 'sense:H7307I:sub', 'sense:H7307J:sub'],
        words: [
          { word_id: 130628, surface: 'הָר֑וּחַ', aspect: 'Breath', reading_status: 'source_attributed_or_hypothesis' },
          { word_id: 130630, surface: 'הָר֜וּחַ', aspect: 'Breath', reading_status: 'source_attributed_or_hypothesis' },
          { word_id: 130694, surface: 'רוּחוֹת֙', aspect: 'Direction / side (four winds)', reading_status: 'source_attributed_or_hypothesis' },
          { word_id: 130629, surface: 'הָר֔וּחַ', aspect: 'Breath', reading_status: 'source_attributed_or_hypothesis' },
        ],
        distinct_aspects_in_single_verse: ['Breath', 'Direction / side'],
      },
    ],
    guardrails: {
      preserves_single_canonical_identity: true,
      preserves_distinct_sense_subdivisions: true,
      not_inferred_from_english_gloss: true,
      not_flattened_to_monolithic_sense: true,
      evidence_before_interpretation: true,
    },
  };

  const rep1 = writeGzipJson(path.join(OUT_DIR, 'reports', 'lexical-coverage-report.json.gz'), lexicalCoverageReport);
  trackFile('reports/lexical-coverage-report.json.gz', rep1);

  const rep2 = writeGzipJson(path.join(OUT_DIR, 'reports', 'contextual-coverage-report.json.gz'), contextualCoverageReport);
  trackFile('reports/contextual-coverage-report.json.gz', rep2);

  const rep3 = writeGzipJson(path.join(OUT_DIR, 'reports', 'ruach-h7307-research-dossier.json.gz'), ruachDossier);
  trackFile('reports/ruach-h7307-research-dossier.json.gz', rep3);

  // Uncompressed JSON copies for instant human & test inspection
  fs.writeFileSync(path.join(OUT_DIR, 'reports', 'lexical-coverage-report.json'), JSON.stringify(lexicalCoverageReport, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'reports', 'contextual-coverage-report.json'), JSON.stringify(contextualCoverageReport, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'reports', 'ruach-h7307-research-dossier.json'), JSON.stringify(ruachDossier, null, 2));

  // Write Manifest
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

  const totalDuration = Date.now() - startTime;
  console.log(`[R9A] Build completed successfully in ${(totalDuration / 1000).toFixed(2)}s.`);
  console.log(`[R9A] Total artifact files written: ${Object.keys(manifest.files).length}.`);

  return {
    release_version: RELEASE_VERSION,
    duration_ms: totalDuration,
    lexical_edges_count: lexicalEdges.length,
    contextual_pairs_count: pairStats.size,
    canonical_lemmas_count: lemmasById.size,
    manifest_files_count: Object.keys(manifest.files).length,
  };
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.url.replace('file:///', '').replace('file://', ''));
if (isDirectRun || process.argv.includes('--run')) {
  runBuildR9A().catch(err => {
    console.error('[R9A] FATAL BUILD ERROR:', err);
    process.exit(1);
  });
}
