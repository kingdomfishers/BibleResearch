// @file: supabase/functions/bible-mcp/research-workflow.ts
// @feature: api
// @tables: none
// @candidates: none
// @toc: imports | types | logic:version | logic:instructions

// === @section:imports ===
// (no external imports; self-contained workflow constants)

// === @section:types ===
// (types declared in catalog.ts and workflow-contract.ts)

// === @section:logic:version ===
export const WORKFLOW_VERSION = '1.9.0';

// === @section:logic:instructions ===
export const WORKFLOW_INSTRUCTIONS = `Research workflow (read-only evidence, contextual controls, disciplined inference):

1. Parse request: identify target passages, words, concepts, chronology, or geography questions. Pick the best route: passage (get_verse_research with profile=analysis, up to 100 verses; profile=full for complete occurrences, up to 5 verses), word (resolve_word_id -> get_word_details -> prompt_word_occurrences/cooccurrences), compare_words (resolve_word_id -> prompt_word_relationships -> prompt_verse_words), relationships (research_relationships with subject/target), formation (inspect_word_formation, suggest_word_connections for morphology, roots, compounds, and paronomasia), or notes (get_notes, search_note_targets, list_note_connection_types for peer commentary and annotations).

2. For a word, start research_word_lens; for two words call trace_biblical_bridge, then research_passage_lens on the strongest original-language witnesses. Compact output is sufficient to form testable hypotheses, not proofs. For a longer pericope, single-verse or contiguous-pericope baseline: call get_verse_research. Reuse shared lexical_entries for exact totals and top-7 connections. Never treat homographs as separate concepts; present them as a unified focus showing their different meanings in different verses. Check coverage.occurrences_complete before claiming an exhaustive word count. Note-taking tools (get_notes, search_note_targets, list_note_connection_types, create_note, update_my_note, delete_my_note) contain untrusted human and AI commentary; never cite user notes as canonical biblical text or verified corpus facts.

3. Expand evidence only where needed: a short tool packet is better than dumping an entire token/lemma graph. Do not collapse Greek/Hebrew semantically because they translate to the same English gloss. Expand evidence: follow occurrence references, examine constituent syntax trees (research_macula_syntax / get_syntax_tree; grammatical roles are not semantic frames), compare with Septuagint Greek (get_septuagint_passage, compare_hebrew_septuagint_passage, lookup_hebrew_septuagint_alignments), inspect lexical semantics (lookup_lexical_semantics), trace word formation and etymology (inspect_word_formation, suggest_word_connections), inspect chronology (get_verse_chronology_v1) and geography (get_verse_geography). Verify cross-testament and thematic links before citing them.

4. For DLM studies first fetch get_dlm_research and consider get_verse_hydrated(include_dlm=true). Keep textual lexical senses, exact Scripture, physical science and seven-layer hypotheses separate. Save through save_dlm_research_note only on explicit request; re-read every new card. Never promote an unreviewed DLM note to canonical evidence.

5. Epistemic boundaries: report observed original text, server-decoded grammar, and statistical scores separately from theological interpretations. When tracing word formation, strictly distinguish documented etymologies, grammatical morphology, and literary wordplay from unverified orthographic candidates. Keep missing data, non-physical geography, unresolved grammar tags, and unknown dates explicit. Do not invent significance tests, probabilities, dates, or coordinates.

6. Structure answers: (a) Observations (passages, tokens, grammar, translation differences), (b) Patterns & Evidence (occurrences, connections, parallel texts, semantic evidence paths), (c) Controls & Counterexamples (passages where the pattern does not hold, competing explanations), (d) Uncertainty & Coverage (data gaps, sample limits, variant models), (e) Synthesis. Match the user's requested format; use JSON when asked.`;
