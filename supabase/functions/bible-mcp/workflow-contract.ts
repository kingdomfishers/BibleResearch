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
  passage: { prompt: 'study_verse', starting_tools: ['get_verse_research'], purpose: 'Passage context, grammar, translation and setting' },
  word: { prompt: 'study_word', starting_tools: ['resolve_word_id', 'get_word_details', 'prompt_word_occurrences'], purpose: 'Word meaning, occurrences and associations' },
  compare_words: { prompt: 'compare_words', starting_tools: ['resolve_word_id', 'prompt_word_relationships'], purpose: 'Word comparison and shared verses' },
  relationships: { prompt: 'study_relationships', starting_tools: ['research_relationships'], purpose: 'Thematic, typological, and concept connections' },
  word_formation: { prompt: 'trace_word_formation', starting_tools: ['inspect_word_formation', 'suggest_word_connections'], purpose: 'Lexical compounds, theophoric names, roots, relatives, and orthographic candidates' },
  chronology: { prompt: 'study_chronology', starting_tools: ['get_verse_chronology_v1'], purpose: 'Multi-model dating and historical evidence' },
  geography: { prompt: 'study_geography', starting_tools: ['get_verse_geography'], purpose: 'Context-aware coordinates and disputed sites' },
  notes: { prompt: 'study_bible', starting_tools: ['get_notes', 'search_note_targets', 'list_note_connection_types'], purpose: 'User commentary, cross-anchor connections, and interpretive notes' },
} as const;

// === @section:logic:tools ===
export const RESEARCH_TOOL_NAMES = [
  'get_research_prompt',
  'get_verse_research',
  'prompt_verse_words',
  'resolve_word_id',
  'get_word_details',
  'prompt_word_occurrences',
  'prompt_word_cooccurrences',
  'prompt_word_relationships',
  'get_verse_chronology_v1',
  'get_verse_geography',
  'research_relationships',
  'inspect_word_formation',
  'suggest_word_connections',
  'get_septuagint_passage',
  'lookup_lexical_semantics',
  'get_syntax_tree',
  'compare_hebrew_septuagint_passage',
  'lookup_hebrew_septuagint_alignments',
  'audit_evidence_coverage',
  'get_notes',
  'search_note_targets',
  'list_note_connection_types',
] as const;
