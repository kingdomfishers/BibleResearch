// One provisional scope shared by backup, restore, simulation and approval checks.
import fs from 'node:fs';

export const RECLAMATION_TABLES = Object.freeze([
  'public.cross_token_mappings', 'public.token_morphemes',
  'public.macula_gated_field_values', 'public.macula_hebrew_morphemes',
  'public.macula_greek_tokens', 'public.word_form_lemmas',
  'public.lxx_swete_words', 'public.morphhb_tokens',
  'public.syntax_edges', 'public.syntax_nodes',
  'public.verse_translation_sources', 'public.tagnt_tokens',
  'public.lexeme_identifiers', 'public.edition_passages',
  'public.reader_rendering_groups', 'public.hebrew_lxx_verse_map',
  'public.reader_english_verses',
  'bible_internal.macula_syntax_unmapped_nodes',
  'bible_internal.macula_syntax_import_files',
]);
export const RETAINED_RELATIONS = Object.freeze([
  'public.hebrew_lxx_word_alignments', 'public.versification_mappings',
  'public.lxx_norm_word_summary', 'public.macula_greekstrong_morphemes',
]);
export function assertReclamationScope(sql = fs.readFileSync('scripts/reclaim-supabase-storage.sql', 'utf8')) {
  const statements = sql.replace(/--[^\n]*/g, '').match(/\bTRUNCATE\s+TABLE\s+([^;]+);/gi) ?? [];
  if (statements.length !== 1) throw Error('Expected exactly one reclamation TRUNCATE statement');
  const targets = statements[0].replace(/^TRUNCATE\s+TABLE\s+/i, '').replace(/;$/, '').split(',').map(s => s.trim()).sort();
  if (JSON.stringify(targets) !== JSON.stringify([...RECLAMATION_TABLES].sort())) throw Error('Reclamation SQL differs from the approved provisional 19-table scope');
  return targets;
}
