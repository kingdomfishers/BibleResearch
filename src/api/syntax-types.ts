// @file: src/api/syntax-types.ts
// @feature: api
// @tables: none
// @candidates: none
// @toc: types:node | types:tree | types:response | types:validation

// === @section:types:node ===
export interface SyntaxNodeRecord {
  id: number;
  node_key: string;
  parent_node_id: number | null;
  depth: number;
  sibling_order: number;
  node_type: 'sentence' | 'clause' | 'phrase' | 'conjoined_phrase' | 'compound_word_group' | 'terminal' | 'token';
  class_label: string | null;
  rule_label: string | null;
  cl_type: string | null;
  syntactic_role: string | null;
  is_head: boolean;
  is_terminal: boolean;
  start_word_position: number;
  end_word_position: number;
  verse_id: number;
  end_verse_id: number;
  is_cross_verse: boolean;
  terminal_xml_id: string | null;
  terminal_word_id: number | null;
  surface_word?: string | null;
  word_transliteration?: string | null;
  word_strongs?: string | null;
  word_grammar?: string | null;
  semantic_frame?: string | null;
}

// === @section:types:tree ===
export interface SyntaxTreeRecord {
  tree_id: string;
  edition_key: string;
  edition_title: string;
  is_cross_verse: boolean;
  start_verse_id: number;
  end_verse_id: number;
  cross_verse_span: string | null;
  root_node_id: number | null;
  nodes_count: number;
  nodes: SyntaxNodeRecord[];
}

export interface SyntaxEdgeRecord {
  id: number;
  source_node_id: number | null;
  target_node_id: number | null;
  relation_type: string;
  raw_relation_tag: string;
  dependent_word_position: number;
  head_word_position: number;
}

export interface CrossVerseSpanSummary {
  tree_id: string;
  start_verse_id: number;
  end_verse_id: number;
  span_length_verses: number;
  rule: string | null;
  class: string | null;
}

// === @section:types:response ===
export interface SyntaxEpistemicInvariants {
  morphology_vs_syntax_distinction: string;
  semantic_role_grounding: string;
  unannotated_policy: string;
  cross_verse_preservation: string;
}

export interface SyntaxTreeResponse {
  verse_id: number;
  book: number;
  chapter: number;
  verse_nr: number;
  has_syntax: boolean;
  syntax_status: 'annotated_in_source' | 'unannotated_in_source';
  missing_syntax_reason: string | null;
  trees_count: number;
  trees: SyntaxTreeRecord[];
  edges_count: number;
  edges: SyntaxEdgeRecord[];
  cross_verse_spans: CrossVerseSpanSummary[];
  epistemic_invariants: SyntaxEpistemicInvariants;
}

// === @section:types:validation ===
export interface SyntaxValidationResponse {
  is_valid: boolean;
  status: 'PASS' | 'FAIL';
  total_nodes: number;
  total_edges: number;
  max_depth: number;
  cross_verse_nodes_count: number;
  cycles_count: number;
  orphaned_parents_count: number;
  span_inversions_count: number;
  verse_inversions_count: number;
  terminals_without_xml_count: number;
  failure_reasons: string[];
}
