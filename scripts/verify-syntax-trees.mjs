// scripts/verify-syntax-trees.mjs
// Deterministic verification suite for MACULA hierarchical syntax trees and grammatical relationships (F6-03)

import crypto from 'node:crypto';
import fs from 'node:fs';

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

function assert(condition, message) {
  if (!condition) {
    console.error(`  [FAIL] ${message}`);
    process.exit(1);
  }
  console.log(`  [PASS] ${message}`);
}

async function main() {
  console.log('=== MACULA Syntactic Structure & Grammar Relationships Verification Suite (F6) ===\n');

  // Test 1: Structural Integrity & Acyclicity via validate_syntax_tree_integrity_v1
  console.log('Test 1: Structural Integrity & Acyclicity Validator');
  const integrity = await rpcCall('validate_syntax_tree_integrity_v1');
  assert(integrity.status === 'PASS', `validate_syntax_tree_integrity_v1 returned PASS (got ${integrity.status})`);
  assert(integrity.is_valid === true, 'Database confirms syntax trees are strictly valid');
  assert(integrity.cycles_count === 0, `Zero cycles detected across all syntax trees (got ${integrity.cycles_count})`);
  assert(integrity.orphaned_parents_count === 0, `Zero orphaned parent references (got ${integrity.orphaned_parents_count})`);
  assert(integrity.span_inversions_count === 0, `Zero span inversions (start <= end on 100% of nodes)`);
  assert(integrity.verse_inversions_count === 0, `Zero verse inversions (verse_id <= end_verse_id)`);
  assert(integrity.terminals_without_xml_count === 0, `Zero terminals lacking source xml_id`);
  assert(integrity.cross_verse_nodes_count >= 100, `Cross-verse structures validated (got ${integrity.cross_verse_nodes_count})`);
  assert(integrity.total_nodes > 10000, `Total syntax nodes in DB exceeds 10,000 (got ${integrity.total_nodes})`);
  console.log('');

  // Test 2: Terminal Node Mapping & Provenance Traceability
  console.log('Test 2: Terminal Node Mapping & Provenance Traceability');
  const gen1 = await rpcCall('lookup_syntax_tree_v1', { p_verse_id: 1, p_edition_key: 'macula-hebrew-wlc' });
  assert(gen1.has_syntax === true, 'Genesis 1:1 has syntax');
  assert(gen1.trees_count === 1, 'Genesis 1:1 returns exactly 1 syntax tree');
  const gTree = gen1.trees[0];
  const gTerminals = gTree.nodes.filter(n => n.is_terminal);
  assert(gTerminals.length === 11, `Genesis 1:1 has exactly 11 terminal morphemes (got ${gTerminals.length})`);
  assert(gTerminals.every(t => t.terminal_xml_id && t.terminal_xml_id.startsWith('o01001001')), 'All terminals possess valid MACULA Hebrew IDs');
  assert(gTerminals.every(t => t.terminal_word_id !== null), 'All terminals map directly to positive public.words.id');
  console.log('');

  // Test 3: Distinction Support (Word Morphology vs Phrase/Clause vs Role vs Semantic Frame)
  console.log('Test 3: Linguistic Distinction Support (Morphology vs Constituent Hierarchy vs Semantic Roles)');
  assert(gen1.epistemic_invariants.morphology_vs_syntax_distinction !== undefined, 'Epistemic invariant documents morphology vs syntax boundary');
  assert(gen1.epistemic_invariants.semantic_role_grounding !== undefined, 'Epistemic invariant documents strict semantic frame grounding');
  
  // Find verb created (bara)
  const baraNode = gTree.nodes.find(n => n.terminal_xml_id === 'o010010010021');
  assert(baraNode !== undefined, 'Node for בָּרָא found in tree');
  assert(baraNode.syntactic_role === 'v', `Syntactic role is 'v' (verb) (got ${baraNode.syntactic_role})`);
  assert(baraNode.semantic_frame !== null && baraNode.semantic_frame.includes('A0:'), `Semantic frame explicitly annotated: ${baraNode.semantic_frame}`);
  console.log('');

  // Test 4: Hebrew Syntax Matching Against Source Treebank (Genesis 1:1, Gen 1:2, Psalm 23:1, Isaiah 53:7)
  console.log('Test 4: Hebrew Syntax Matching Against Source Treebank');
  // Root clause of Gen 1:1
  const rootClause = gTree.nodes.find(n => n.node_type === 'clause' && n.rule_label === 'PP-V-S-O');
  assert(rootClause !== undefined, 'Genesis 1:1 contains top-level clause with rule PP-V-S-O');
  assert(rootClause.class_label === 'cl', 'Class label is cl (clause)');

  // Child phrases of PP-V-S-O
  const pp = gTree.nodes.find(n => n.parent_node_id === rootClause.id && n.class_label === 'pp');
  assert(pp !== undefined && pp.rule_label === 'PrepNp', 'PP-V-S-O contains PrepNp child phrase');

  const obj = gTree.nodes.find(n => n.parent_node_id === rootClause.id && n.syntactic_role === 'o');
  assert(obj !== undefined && obj.rule_label === 'NpaNp', 'PP-V-S-O contains object NpaNp phrase');

  // Dynamic verse ID lookup helper
  async function getVerseId(b, c, v) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/verses?book=eq.${b}&chapter=eq.${c}&verse_nr=eq.${v}&select=id`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
    });
    const rows = await res.json();
    return rows[0]?.id;
  }

  const ps23_1_id = await getVerseId(19, 23, 1);
  const isa53_7_id = await getVerseId(23, 53, 7);
  const john1_1_id = await getVerseId(43, 1, 1);
  const rom3_21_id = await getVerseId(45, 3, 21);
  const eph1_3_id = await getVerseId(49, 1, 3);

  // Psalm 23:1 check
  const ps23 = await rpcCall('lookup_syntax_tree_v1', { p_verse_id: ps23_1_id, p_edition_key: 'macula-hebrew-wlc' });
  assert(ps23.has_syntax === true, 'Psalm 23:1 has syntax tree');
  assert(ps23.trees[0].nodes.some(n => n.node_type === 'clause'), 'Psalm 23:1 contains constituent clause structure');

  // Isaiah 53:7 check
  const isa53 = await rpcCall('lookup_syntax_tree_v1', { p_verse_id: isa53_7_id, p_edition_key: 'macula-hebrew-wlc' });
  assert(isa53.has_syntax === true, 'Isaiah 53:7 has syntax tree');
  assert(isa53.trees[0].nodes.length > 20, `Isaiah 53:7 contains rich constituent tree (${isa53.trees[0].nodes.length} nodes)`);
  console.log('');

  // Test 5: Greek Syntax Matching Against Source Treebank (John 1:1, Romans 3:21)
  console.log('Test 5: Greek Syntax Matching Against Source Treebank');
  // John 1:1
  const john1 = await rpcCall('lookup_syntax_tree_v1', { p_verse_id: john1_1_id, p_edition_key: 'macula-greek-nestle1904' });
  assert(john1.has_syntax === true, 'John 1:1 has Greek syntax tree');
  assert(john1.trees_count === 1, 'John 1:1 has 1 syntax tree');
  const jTree = john1.trees[0];
  const topClause = jTree.nodes.find(n => n.rule_label === 'Conj3CL');
  assert(topClause !== undefined, 'John 1:1 root has rule Conj3CL (conjunction of 3 clauses)');
  
  // 3 subordinate clauses under Conj3CL
  const clauses = jTree.nodes.filter(n => n.node_type === 'clause');
  assert(clauses.length === 4, `John 1:1 contains 4 clause nodes (Conj3CL + 3 constituent clauses: P-VC-S, S-VC-P, P-VC-S) (got ${clauses.length})`);
  const clauseRules = clauses.map(c => c.rule_label);
  assert(clauseRules.includes('Conj3CL'), 'Conj3CL compound clause present');
  assert(clauseRules.includes('P-VC-S'), 'P-VC-S clause present (Ἐν ἀρχῇ ἦν ὁ Λόγος / καὶ Θεὸς ἦν ὁ Λόγος)');
  assert(clauseRules.includes('S-VC-P'), 'S-VC-P clause present (καὶ ὁ Λόγος ἦν πρὸς τὸν Θεόν)');

  // Romans 3:21
  const rom3 = await rpcCall('lookup_syntax_tree_v1', { p_verse_id: rom3_21_id, p_edition_key: 'macula-greek-nestle1904' });
  assert(rom3.has_syntax === true, 'Romans 3:21 has syntax tree');
  assert(rom3.trees[0].nodes.some(n => n.node_type === 'clause'), 'Romans 3:21 contains constituent clause structure');
  console.log('');

  // Test 6: Cross-Verse Syntactic Structure Preservation (Ephesians 1:3–14)
  console.log('Test 6: Cross-Verse Syntactic Structure Preservation');
  // Ephesians 1:3
  const eph1 = await rpcCall('lookup_syntax_tree_v1', { p_verse_id: eph1_3_id, p_edition_key: 'macula-greek-nestle1904' });
  assert(eph1.has_syntax === true, 'Ephesians 1:3 has syntax tree');
  const ephTree = eph1.trees[0];
  assert(ephTree.is_cross_verse === true, 'Ephesians 1:3 tree is explicitly identified as cross-verse');
  assert(ephTree.cross_verse_span !== null, `Cross-verse span reported: ${ephTree.cross_verse_span}`);
  assert(ephTree.end_verse_id > ephTree.start_verse_id, `End verse (${ephTree.end_verse_id}) > start verse (${ephTree.start_verse_id})`);
  assert(eph1.cross_verse_spans.length > 0, 'Cross-verse summary metadata array populated');
  console.log('');

  // Test 7: Missing Syntax Transparency (No Guessed or Hallucinated Trees)
  console.log('Test 7: Missing Syntax Transparency');
  // Query a verse outside our annotated pericopes (e.g. Luke 23:5 = 26048)
  const unannotated = await rpcCall('lookup_syntax_tree_v1', { p_verse_id: 26048, p_edition_key: 'macula-hebrew-wlc' });
  assert(unannotated.has_syntax === false, 'Unannotated verse reports has_syntax === false');
  assert(unannotated.syntax_status === 'unannotated_in_source', `Status is unannotated_in_source (got ${unannotated.syntax_status})`);
  assert(unannotated.missing_syntax_reason !== null, 'Missing syntax reason is transparently populated');
  assert(unannotated.trees_count === 0, 'Zero trees fabricated for unannotated verse');
  assert(unannotated.edges_count === 0, 'Zero edges fabricated for unannotated verse');
  console.log('');

  // Test 8: Deterministic Query Reproducibility
  console.log('Test 8: Deterministic Query Reproducibility');
  const runA = await rpcCall('lookup_syntax_tree_v1', { p_verse_id: 1, p_edition_key: 'macula-hebrew-wlc' });
  const runB = await rpcCall('lookup_syntax_tree_v1', { p_verse_id: 1, p_edition_key: 'macula-hebrew-wlc' });
  const strA = JSON.stringify(runA);
  const strB = JSON.stringify(runB);
  assert(strA === strB, 'Repeated syntax queries produce bitwise identical JSON results');
  console.log('');

  console.log('======================================================');
  console.log('ALL TESTS PASSED: Syntactic Structure & Grammar Relationships verified.');
  console.log('======================================================');
}

main().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
