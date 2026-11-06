// @file: supabase/functions/bible-mcp/workflow-contract.ts
// @feature: api
// @tables: none
// @candidates: none
// @toc: logic:profiles | logic:routes | logic:tools

// === @section:logic:profiles ===
export const RESEARCH_PROFILES = {
  analysis: { mode: 'sample', limit: 5 },
  full: { mode: 'all' },
} as const;

// === @section:logic:routes ===
export const WORKFLOW_ROUTES = {
  tokens: { prompt: 'study_verse', starting_tools: ['prompt_verse_words'], purpose: 'Original ordered tokens only' },
  verse: { prompt: 'study_verse', starting_tools: ['get_verse_research'], purpose: 'Explain a passage with hydrated evidence' },
  word: { prompt: 'study_word', starting_tools: ['resolve_word_id', 'get_word_details'], purpose: 'Resolve lexical identity before studying usage' },
  compare: { prompt: 'compare_words', starting_tools: ['resolve_word_id', 'prompt_word_relationships'], purpose: 'Compare real word IDs and shared-verse density' },
  motif: { prompt: 'trace_motifs', starting_tools: ['research_relationships', 'get_verse_research'], purpose: 'Inspect reviewed candidates and test cited passages and controls' },
  chronology: { prompt: 'study_chronology', starting_tools: ['get_verse_chronology_v1'], purpose: 'Inspect dating models, assumptions and evidence' },
  geography: { prompt: 'study_geography', starting_tools: ['get_verse_geography'], purpose: 'Inspect physical, disputed and symbolic settings' },
  septuagint: { prompt: 'study_verse', starting_tools: ['get_septuagint_passage'], purpose: 'Septuagint Greek tokens and correspondence' },
  lexical: { prompt: 'study_word', starting_tools: ['lookup_lexical_semantics'], purpose: 'Multi-tier lexical semantics, roots, and senses' },
  syntax: { prompt: 'study_verse', starting_tools: ['get_syntax_tree'], purpose: 'Hierarchical syntax trees and constituent grammar' },
  comparison: { prompt: 'compare_words', starting_tools: ['compare_hebrew_septuagint_passage'], purpose: 'Hebrew and Septuagint parallel with 3-tier alignments' },
  audit: { prompt: 'study_bible', starting_tools: ['audit_evidence_coverage'], purpose: 'Corpus coverage and evidence integrity audit' },
} as const;

// === @section:logic:tools ===
export const RESEARCH_TOOL_NAMES = [
  'get_research_prompt', 'get_verse_research', 'prompt_verse_words',
  'prompt_word_occurrences', 'prompt_word_cooccurrences', 'prompt_word_relationships',
  'resolve_word_id', 'get_word_details', 'get_verse_chronology_v1',
  'get_verse_geography', 'research_relationships',
  'get_septuagint_passage', 'lookup_lexical_semantics', 'get_syntax_tree',
  'compare_hebrew_septuagint_passage', 'lookup_hebrew_septuagint_alignments',
  'audit_evidence_coverage',
] as const;
