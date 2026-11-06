-- @file: supabase/migrations/20261105230000_canonical_lexical_and_evidence_schema.sql
-- @feature: canonical-lexical-evidence-db
-- @description: Additive canonical biblical lexical and evidence schema separating word forms, lemmas, lexemes, roots, senses, translation glosses, versification mappings, syntax/morphology, external concept properties/links, and provenance-complete entity relationships. Includes security & TBESH licensing remediation.

-- ============================================================================
-- 0. SECURITY & LICENSING REMEDIATION
-- ============================================================================
-- 0a. Restrict SECURITY DEFINER batch ingestion helper strictly to service_role
--     and pin search_path on decode_grammar_v1.
revoke all on function public.ingest_lexemes_batch_v1(jsonb) from public, anon, authenticated;
grant execute on function public.ingest_lexemes_batch_v1(jsonb) to service_role;
alter function public.decode_grammar_v1(text) set search_path = '';

-- 0b. Restore curated H0430G homograph_note and purge restricted Online Bible
--     TBESH column 7 ("Meaning") text from non-curated Hebrew/Aramaic lexemes,
--     retaining only CC BY 4.0 STEP dStrong/uStrong relation markers.
update public.lexemes
set homograph_note = 'Disambiguated STEP tag for the God of Israel, distinct from H0430a (plural gods/rulers).'
where id = 12 and lexeme_key = 'H0430G';

update public.lexemes
set homograph_note = case
  when disambiguated_strongs is not null and disambiguated_strongs ~ '=\s+[A-Za-z]'
    then 'STEP dStrong relation: ' || regexp_replace(disambiguated_strongs, '^[HG0-9A-Za-z]+\s*', '')
         || coalesce(' ' || unified_strongs, '')
  else null
end
where language in ('hbo', 'arc')
  and id > 15;

-- ============================================================================
-- 1. SOURCE RELEASES (EXTENDED) & SOURCE EDITIONS
-- ============================================================================
alter table public.source_releases
  add column if not exists version_label text,
  add column if not exists source_url text,
  add column if not exists sha256_manifest jsonb not null default '{}'::jsonb,
  add column if not exists licensing_constraints text,
  add column if not exists epistemic_layer text not null default 'primary_biblical'
    check (epistemic_layer in ('primary_biblical', 'lexical_reference', 'external_factual', 'reviewed_research'));

create table if not exists public.source_editions (
  id bigint generated always as identity primary key,
  edition_key text not null unique,
  source_release_id bigint not null references public.source_releases(id),
  edition_kind text not null check (edition_kind in (
    'hebrew_aramaic_text',
    'greek_text',
    'lexicon',
    'english_translation',
    'versification_system',
    'external_gazetteer',
    'chronology_dataset',
    'annotation_corpus'
  )),
  title text not null,
  language text not null check (language in ('hbo', 'arc', 'grc', 'en', 'mul')),
  testament_scope text not null check (testament_scope in ('OT', 'NT', 'Both')),
  versification_scheme text not null check (versification_scheme in (
    'english_standard',
    'masoretic_hebrew',
    'greek_eclectic',
    'kjv_1769',
    'not_applicable'
  )),
  license text not null,
  licensing_notes text,
  source_url text,
  file_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_source_editions_release on public.source_editions (source_release_id);

-- ============================================================================
-- 2. EDITION PASSAGES & VERSIFICATION MAPPINGS
-- ============================================================================
create table if not exists public.edition_passages (
  id bigint generated always as identity primary key,
  edition_id bigint not null references public.source_editions(id),
  book smallint not null references public.books(id),
  chapter smallint not null check (chapter >= 0),
  verse_nr smallint not null check (verse_nr >= 0),
  edition_ref text not null,
  canonical_verse_id integer references public.verses(id),
  token_count smallint check (token_count is null or token_count >= 0),
  witness_tag text,
  source_record_id text not null,
  unique (edition_id, edition_ref)
);

create index if not exists idx_edition_passages_canonical_verse on public.edition_passages (canonical_verse_id);
create index if not exists idx_edition_passages_bcv on public.edition_passages (book, chapter, verse_nr);

create table if not exists public.versification_mappings (
  id bigint generated always as identity primary key,
  canonical_verse_id integer not null references public.verses(id),
  from_edition_id bigint not null references public.source_editions(id),
  from_ref text not null,
  to_edition_id bigint not null references public.source_editions(id),
  to_book smallint not null references public.books(id),
  to_chapter smallint not null check (to_chapter >= 0),
  to_verse_nr smallint not null check (to_verse_nr >= 0),
  to_ref text not null,
  mapping_kind text not null check (mapping_kind in (
    'chapter_verse_shift',
    'psalm_superscription_shift',
    'kjv_bracket_shift',
    'split_or_merged',
    'absent_in_edition'
  )),
  source_release_id bigint not null references public.source_releases(id),
  source_record_id text not null check (btrim(source_record_id) <> ''),
  origin_mode text not null default 'directly_imported' check (origin_mode in (
    'directly_imported',
    'algorithmically_calculated',
    'user_authored'
  )),
  derivation_method text not null,
  algorithm_version text,
  unique (canonical_verse_id, from_edition_id, to_edition_id, to_ref)
);

create index if not exists idx_versification_from_edition on public.versification_mappings (from_edition_id);
create index if not exists idx_versification_to_edition on public.versification_mappings (to_edition_id);
create index if not exists idx_versification_to_bcv on public.versification_mappings (to_book, to_chapter, to_verse_nr);
create index if not exists idx_versification_release on public.versification_mappings (source_release_id);

-- ============================================================================
-- 3. CANONICAL LEMMAS, LEXEME IDENTIFIERS & INFLECTED WORD-FORM LINKS
-- ============================================================================
-- Modeling rule: A word form (public.words) is NOT a lemma (public.lemmas).
-- Homographs (e.g., H1254A/B/C, H5869a/b) retain distinct canonical lemma rows.
create table if not exists public.lemmas (
  id bigint generated always as identity primary key,
  lemma_key text not null unique,
  language text not null check (language in ('hbo', 'arc', 'grc')),
  lemma_script text not null,
  lemma_stripped text not null,
  transliteration text not null,
  primary_pos text,
  homograph_tag text,
  base_strongs text,
  primary_lexeme_id bigint references public.lexemes(id),
  source_release_id bigint not null references public.source_releases(id),
  source_edition_id bigint references public.source_editions(id),
  source_record_id text not null check (btrim(source_record_id) <> '')
);

create index if not exists idx_lemmas_script on public.lemmas (lemma_script);
create index if not exists idx_lemmas_stripped on public.lemmas (lemma_stripped);
create index if not exists idx_lemmas_translit on public.lemmas (lower(transliteration));
create index if not exists idx_lemmas_base_strongs on public.lemmas (base_strongs);
create index if not exists idx_lemmas_primary_lexeme on public.lemmas (primary_lexeme_id);
create index if not exists idx_lemmas_release on public.lemmas (source_release_id);
create index if not exists idx_lemmas_edition on public.lemmas (source_edition_id);

alter table public.lexemes
  add column if not exists lemma_id bigint references public.lemmas(id),
  add column if not exists source_edition_id bigint references public.source_editions(id),
  add column if not exists source_record_id text;

create index if not exists idx_lexemes_lemma_id on public.lexemes (lemma_id);
create index if not exists idx_lexemes_source_edition on public.lexemes (source_edition_id);

create table if not exists public.lexeme_identifiers (
  id bigint generated always as identity primary key,
  lexeme_id bigint not null references public.lexemes(id),
  id_namespace text not null check (id_namespace in (
    'base_strongs',
    'extended_strongs',
    'disambiguated_strongs',
    'unified_strongs',
    'step_lexeme_key'
  )),
  id_value text not null,
  is_primary boolean not null default false,
  source_release_id bigint not null references public.source_releases(id),
  source_edition_id bigint references public.source_editions(id),
  source_record_id text not null,
  unique (lexeme_id, id_namespace, id_value)
);

create index if not exists idx_lexeme_identifiers_lookup on public.lexeme_identifiers (id_namespace, id_value);
create index if not exists idx_lexeme_identifiers_release on public.lexeme_identifiers (source_release_id);
create index if not exists idx_lexeme_identifiers_edition on public.lexeme_identifiers (source_edition_id);

-- Maps inflected surface word forms (public.words) to their constituent morphemes,
-- canonical lemmas, and lexical entries without conflating surface form and lemma.
create table if not exists public.word_form_lemmas (
  id bigint generated always as identity primary key,
  word_id integer not null references public.words(id),
  component_order smallint not null default 1 check (component_order >= 1),
  morpheme_role text not null check (morpheme_role in (
    'stem',
    'prefix_preposition',
    'prefix_conjunction',
    'prefix_article',
    'prefix_particle',
    'pronominal_suffix',
    'particle'
  )),
  morpheme_surface text,
  morpheme_gloss text,
  grammar_code text,
  dstrongs_tag text not null,
  lemma_id bigint references public.lemmas(id),
  lexeme_id bigint references public.lexemes(id),
  observed_token_count integer not null default 0 check (observed_token_count >= 0),
  is_context_ambiguous boolean not null default false,
  source_release_id bigint not null references public.source_releases(id),
  source_edition_id bigint references public.source_editions(id),
  source_record_id text not null check (btrim(source_record_id) <> ''),
  origin_mode text not null default 'directly_imported' check (origin_mode in (
    'directly_imported',
    'algorithmically_calculated'
  )),
  derivation_method text not null,
  algorithm_version text,
  unique (word_id, component_order, dstrongs_tag)
);

create index if not exists idx_word_form_lemmas_word on public.word_form_lemmas (word_id, component_order);
create index if not exists idx_word_form_lemmas_lemma on public.word_form_lemmas (lemma_id);
create index if not exists idx_word_form_lemmas_lexeme on public.word_form_lemmas (lexeme_id);
create index if not exists idx_word_form_lemmas_release on public.word_form_lemmas (source_release_id);
create index if not exists idx_word_form_lemmas_edition on public.word_form_lemmas (source_edition_id);

-- ============================================================================
-- 4. DOCUMENTED LEXICAL ROOTS & ETYMOLOGICAL RELATIONSHIPS
-- ============================================================================
-- Modeling rules:
--   1. A lemma is NOT necessarily a root.
--   2. A root is NOT a meaning (no meaning/gloss column exists on lexical_roots).
--   3. Two words sharing a root MUST NOT automatically be marked as synonymous.
create table if not exists public.lexical_roots (
  id bigint generated always as identity primary key,
  root_key text not null unique,
  language text not null check (language in ('hbo', 'arc', 'grc')),
  root_script text not null,
  root_stripped text not null,
  transliteration text,
  root_kind text not null check (root_kind in (
    'documented_lexical_base',
    'greek_etymological_stem',
    'semitic_cross_dialect_base'
  )),
  anchor_lexeme_id bigint references public.lexemes(id),
  source_release_id bigint not null references public.source_releases(id),
  source_edition_id bigint references public.source_editions(id),
  source_record_id text not null check (btrim(source_record_id) <> '')
);

comment on table public.lexical_roots is
  'Documented etymological/morphological roots and base stems. Intentionally excludes any meaning/gloss column because a root is not a meaning.';

create index if not exists idx_lexical_roots_script on public.lexical_roots (root_script);
create index if not exists idx_lexical_roots_anchor_lexeme on public.lexical_roots (anchor_lexeme_id);
create index if not exists idx_lexical_roots_release on public.lexical_roots (source_release_id);
create index if not exists idx_lexical_roots_edition on public.lexical_roots (source_edition_id);

create table if not exists public.lemma_root_links (
  id bigint generated always as identity primary key,
  lemma_id bigint not null references public.lemmas(id),
  root_id bigint not null references public.lexical_roots(id),
  etymology_type text not null check (etymology_type in (
    'base_root_anchor',
    'derived_from',
    'aramaic_cognate_of',
    'hebrew_cognate_of',
    'greek_loan_or_transliteration',
    'compound_part_of',
    'combination_of',
    'group_member_of',
    'spelling_variant_of',
    'form_of',
    'shared_name_base'
  )),
  implies_synonymy boolean not null default false check (implies_synonymy = false),
  evidence_note text,
  source_release_id bigint not null references public.source_releases(id),
  source_edition_id bigint references public.source_editions(id),
  source_record_id text not null check (btrim(source_record_id) <> ''),
  origin_mode text not null check (origin_mode in ('directly_imported', 'algorithmically_calculated')),
  derivation_method text not null,
  algorithm_version text,
  unique (lemma_id, root_id, etymology_type)
);

create index if not exists idx_lemma_root_links_root on public.lemma_root_links (root_id);
create index if not exists idx_lemma_root_links_release on public.lemma_root_links (source_release_id);
create index if not exists idx_lemma_root_links_edition on public.lemma_root_links (source_edition_id);

-- ============================================================================
-- 5. LEXICAL SENSES (SEPARATED FROM ENGLISH TRANSLATION GLOSSES)
-- ============================================================================
-- Modeling rule: A lexical sense has its own definition and source, and is NOT
-- identical to a contextual English translation rendering.
create table if not exists public.lexical_senses (
  id bigint generated always as identity primary key,
  sense_key text not null unique,
  lemma_id bigint not null references public.lemmas(id),
  lexeme_id bigint not null references public.lexemes(id),
  parent_sense_id bigint references public.lexical_senses(id),
  sense_code text not null,
  sense_order smallint not null default 1,
  short_gloss text not null,
  definition_text text not null,
  usage_note text,
  scripture_refs text[] not null default '{}',
  source_attribution text not null,
  source_release_id bigint not null references public.source_releases(id),
  source_edition_id bigint not null references public.source_editions(id),
  source_record_id text not null check (btrim(source_record_id) <> '')
);

create index if not exists idx_lexical_senses_lemma on public.lexical_senses (lemma_id, sense_order);
create index if not exists idx_lexical_senses_lexeme on public.lexical_senses (lexeme_id, sense_order);
create index if not exists idx_lexical_senses_parent on public.lexical_senses (parent_sense_id);
create index if not exists idx_lexical_senses_release on public.lexical_senses (source_release_id);
create index if not exists idx_lexical_senses_edition on public.lexical_senses (source_edition_id);

-- ============================================================================
-- 6. TOKEN MORPHEMES, SYNTAX NODES, SYNTAX EDGES & SEMANTIC ANNOTATIONS
-- ============================================================================
create table if not exists public.token_morphemes (
  id bigint generated always as identity primary key,
  edition_id bigint not null references public.source_editions(id),
  verse_id integer not null references public.verses(id),
  word_position integer not null check (word_position >= 1),
  component_order smallint not null default 1 check (component_order >= 1),
  morpheme_role text not null check (morpheme_role in (
    'stem',
    'prefix_preposition',
    'prefix_conjunction',
    'prefix_article',
    'prefix_particle',
    'pronominal_suffix',
    'particle'
  )),
  surface_form text,
  transliteration text,
  grammar_code text,
  morpheme_gloss text,
  dstrongs_tag text not null,
  lemma_id bigint references public.lemmas(id),
  lexeme_id bigint references public.lexemes(id),
  source_release_id bigint not null references public.source_releases(id),
  source_record_id text not null,
  unique (edition_id, verse_id, word_position, component_order)
);

create index if not exists idx_token_morphemes_verse on public.token_morphemes (verse_id, word_position, component_order);
create index if not exists idx_token_morphemes_lemma on public.token_morphemes (lemma_id);
create index if not exists idx_token_morphemes_lexeme on public.token_morphemes (lexeme_id);
create index if not exists idx_token_morphemes_release on public.token_morphemes (source_release_id);

create table if not exists public.syntax_nodes (
  id bigint generated always as identity primary key,
  node_key text not null unique,
  edition_id bigint not null references public.source_editions(id),
  verse_id integer not null references public.verses(id),
  node_type text not null check (node_type in (
    'token',
    'compound_word_group',
    'conjoined_phrase',
    'clause'
  )),
  start_word_position integer not null check (start_word_position >= 1),
  end_word_position integer not null check (end_word_position >= start_word_position),
  head_word_position integer check (head_word_position is null or head_word_position >= 1),
  syntactic_role text,
  grammar_summary text,
  source_release_id bigint not null references public.source_releases(id),
  source_record_id text not null
);

create index if not exists idx_syntax_nodes_verse on public.syntax_nodes (verse_id, start_word_position);
create index if not exists idx_syntax_nodes_edition on public.syntax_nodes (edition_id);
create index if not exists idx_syntax_nodes_release on public.syntax_nodes (source_release_id);

create table if not exists public.syntax_edges (
  id bigint generated always as identity primary key,
  edition_id bigint not null references public.source_editions(id),
  verse_id integer not null references public.verses(id),
  dependent_word_position integer not null check (dependent_word_position >= 1),
  head_word_position integer not null check (head_word_position >= 1),
  source_node_id bigint references public.syntax_nodes(id),
  target_node_id bigint references public.syntax_nodes(id),
  relation_type text not null check (relation_type in (
    'conjoin_forward_head',
    'conjoin_backward_head',
    'prefix_to_stem',
    'suffix_to_stem',
    'modifier_attachment',
    'clause_dependency'
  )),
  head_strongs text,
  raw_relation_tag text not null,
  source_release_id bigint not null references public.source_releases(id),
  source_record_id text not null check (btrim(source_record_id) <> ''),
  origin_mode text not null default 'directly_imported' check (origin_mode in (
    'directly_imported',
    'algorithmically_calculated'
  )),
  derivation_method text not null,
  algorithm_version text,
  unique (edition_id, verse_id, dependent_word_position, head_word_position, relation_type)
);

create index if not exists idx_syntax_edges_verse on public.syntax_edges (verse_id, dependent_word_position);
create index if not exists idx_syntax_edges_source_node on public.syntax_edges (source_node_id);
create index if not exists idx_syntax_edges_target_node on public.syntax_edges (target_node_id);
create index if not exists idx_syntax_edges_release on public.syntax_edges (source_release_id);

create table if not exists public.semantic_annotations (
  id bigint generated always as identity primary key,
  edition_id bigint not null references public.source_editions(id),
  verse_id integer not null references public.verses(id),
  start_word_position integer not null check (start_word_position >= 1),
  end_word_position integer not null check (end_word_position >= start_word_position),
  annotation_kind text not null check (annotation_kind in (
    'step_sub_meaning',
    'named_entity_identity',
    'contextual_lexeme_tag',
    'literary_motif_span',
    'user_note'
  )),
  annotation_value text not null,
  lemma_id bigint references public.lemmas(id),
  lexeme_id bigint references public.lexemes(id),
  sense_id bigint references public.lexical_senses(id),
  concept_id bigint references public.concepts(id),
  epistemic_layer text not null default 'lexical_reference' check (epistemic_layer in (
    'primary_biblical',
    'lexical_reference',
    'external_factual',
    'reviewed_interpretation',
    'user_interpretation'
  )),
  origin_mode text not null check (origin_mode in (
    'directly_imported',
    'algorithmically_calculated',
    'user_authored'
  )),
  derivation_method text,
  algorithm_version text,
  review_status text not null default 'reviewed' check (review_status in ('reviewed', 'candidate', 'rejected')),
  owner_user_id uuid references auth.users(id),
  source_release_id bigint not null references public.source_releases(id),
  source_record_id text not null check (btrim(source_record_id) <> ''),
  check (
    (origin_mode = 'user_authored' and owner_user_id is not null and epistemic_layer = 'user_interpretation')
    or (origin_mode <> 'user_authored' and owner_user_id is null)
  ),
  unique (edition_id, verse_id, start_word_position, end_word_position, annotation_kind, source_record_id)
);

create index if not exists idx_semantic_annotations_verse on public.semantic_annotations (verse_id, start_word_position);
create index if not exists idx_semantic_annotations_lemma on public.semantic_annotations (lemma_id);
create index if not exists idx_semantic_annotations_lexeme on public.semantic_annotations (lexeme_id);
create index if not exists idx_semantic_annotations_sense on public.semantic_annotations (sense_id);
create index if not exists idx_semantic_annotations_concept on public.semantic_annotations (concept_id);
create index if not exists idx_semantic_annotations_owner on public.semantic_annotations (owner_user_id);
create index if not exists idx_semantic_annotations_release on public.semantic_annotations (source_release_id);

-- ============================================================================
-- 7. EXTERNAL CONCEPTS, FACTUAL PROPERTIES & HYPERLINKS
-- ============================================================================
alter table public.concepts
  add column if not exists external_entity_type text,
  add column if not exists epistemic_layer text not null default 'reviewed_research'
    check (epistemic_layer in ('primary_biblical', 'lexical_reference', 'external_factual', 'reviewed_research')),
  add column if not exists source_release_id bigint references public.source_releases(id),
  add column if not exists source_edition_id bigint references public.source_editions(id),
  add column if not exists source_record_id text;

create index if not exists idx_concepts_release on public.concepts (source_release_id);
create index if not exists idx_concepts_edition on public.concepts (source_edition_id);

create table if not exists public.concept_properties (
  id bigint generated always as identity primary key,
  concept_id bigint not null references public.concepts(id),
  property_key text not null,
  property_value text not null,
  value_type text not null default 'string' check (value_type in (
    'string',
    'number',
    'boolean',
    'coordinate',
    'year_range',
    'identifier'
  )),
  unit text,
  epistemic_layer text not null default 'external_factual' check (epistemic_layer in (
    'primary_biblical',
    'lexical_reference',
    'external_factual',
    'reviewed_interpretation'
  )),
  external_citation text,
  source_release_id bigint not null references public.source_releases(id),
  source_edition_id bigint references public.source_editions(id),
  source_record_id text not null check (btrim(source_record_id) <> ''),
  unique (concept_id, property_key, property_value, source_record_id)
);

create index if not exists idx_concept_properties_concept on public.concept_properties (concept_id, property_key);
create index if not exists idx_concept_properties_release on public.concept_properties (source_release_id);
create index if not exists idx_concept_properties_edition on public.concept_properties (source_edition_id);

create table if not exists public.concept_external_links (
  id bigint generated always as identity primary key,
  concept_id bigint not null references public.concepts(id),
  provider text not null check (provider in (
    'pleiades',
    'openbible',
    'theographic',
    'stepbible_tipnr',
    'stepbible_lexicon',
    'ebible_web',
    'wikidata'
  )),
  external_id text not null,
  external_url text not null check (external_url ~ '^https?://'),
  link_relation text not null check (link_relation in (
    'exact_match',
    'close_match',
    'gazetteer_reference',
    'chronology_reference',
    'lexical_reference'
  )),
  license text not null,
  source_release_id bigint not null references public.source_releases(id),
  source_record_id text not null check (btrim(source_record_id) <> ''),
  unique (concept_id, provider, external_id)
);

create index if not exists idx_concept_external_links_provider on public.concept_external_links (provider, external_id);
create index if not exists idx_concept_external_links_release on public.concept_external_links (source_release_id);

-- ============================================================================
-- 8. UNIFIED CANONICAL ENTITIES & PROVENANCE-COMPLETE EVIDENCE RELATIONSHIPS
-- ============================================================================
create table if not exists public.relation_types (
  relation_type text primary key,
  category text not null check (category in (
    'lexical',
    'etymological',
    'morphosyntactic',
    'versification',
    'external_factual',
    'textual_parallel',
    'interpretive'
  )),
  inverse_relation_type text,
  is_symmetric boolean not null default false,
  implies_synonymy boolean not null default false,
  description text not null,
  check (not (category = 'etymological' and implies_synonymy))
);

create table if not exists public.canonical_entities (
  id bigint generated always as identity primary key,
  entity_key text not null unique,
  entity_kind text not null check (entity_kind in (
    'word_form',
    'lemma',
    'lexeme',
    'root',
    'sense',
    'passage',
    'concept',
    'place',
    'chronology_event',
    'research_node'
  )),
  display_label text not null,
  language text,
  word_id integer references public.words(id),
  lemma_id bigint references public.lemmas(id),
  lexeme_id bigint references public.lexemes(id),
  root_id bigint references public.lexical_roots(id),
  sense_id bigint references public.lexical_senses(id),
  verse_id integer references public.verses(id),
  concept_id bigint references public.concepts(id),
  place_id bigint references public.places(id),
  chronology_event_id bigint references public.chronology_events(id),
  research_node_id bigint references public.research_nodes(id),
  source_release_id bigint references public.source_releases(id),
  source_record_id text,
  check (
    num_nonnulls(
      word_id, lemma_id, lexeme_id, root_id, sense_id,
      verse_id, concept_id, place_id, chronology_event_id, research_node_id
    ) = 1
  )
);

create index if not exists idx_canonical_entities_kind on public.canonical_entities (entity_kind);
create index if not exists idx_canonical_entities_word on public.canonical_entities (word_id) where word_id is not null;
create index if not exists idx_canonical_entities_lemma on public.canonical_entities (lemma_id) where lemma_id is not null;
create index if not exists idx_canonical_entities_lexeme on public.canonical_entities (lexeme_id) where lexeme_id is not null;
create index if not exists idx_canonical_entities_root on public.canonical_entities (root_id) where root_id is not null;
create index if not exists idx_canonical_entities_sense on public.canonical_entities (sense_id) where sense_id is not null;
create index if not exists idx_canonical_entities_verse on public.canonical_entities (verse_id) where verse_id is not null;
create index if not exists idx_canonical_entities_concept on public.canonical_entities (concept_id) where concept_id is not null;
create index if not exists idx_canonical_entities_place on public.canonical_entities (place_id) where place_id is not null;
create index if not exists idx_canonical_entities_event on public.canonical_entities (chronology_event_id) where chronology_event_id is not null;
create index if not exists idx_canonical_entities_rnode on public.canonical_entities (research_node_id) where research_node_id is not null;
create index if not exists idx_canonical_entities_release on public.canonical_entities (source_release_id);

-- Every imported, calculated, or user-authored relationship preserves:
--   1. source dataset (source_release_id)
--   2. exact source record identifier (source_record_id)
--   3. edition or version (source_edition_id)
--   4. relation type (relation_type)
--   5. supporting textual span or external citation
--   6. origin mode (directly_imported | algorithmically_calculated | user_authored)
--   7. derivation method and algorithm version where applicable
create table if not exists public.entity_relationships (
  id bigint generated always as identity primary key,
  relationship_key text not null unique,
  subject_entity_id bigint not null references public.canonical_entities(id),
  object_entity_id bigint not null references public.canonical_entities(id),
  relation_type text not null references public.relation_types(relation_type),
  epistemic_layer text not null check (epistemic_layer in (
    'primary_biblical',
    'lexical_reference',
    'external_factual',
    'reviewed_interpretation',
    'user_interpretation'
  )),
  origin_mode text not null check (origin_mode in (
    'directly_imported',
    'algorithmically_calculated',
    'user_authored'
  )),
  derivation_method text,
  algorithm_version text,
  score numeric,
  supporting_span_ref text,
  supporting_verse_id integer references public.verses(id),
  external_citation text,
  evidence_summary text not null,
  source_release_id bigint not null references public.source_releases(id),
  source_edition_id bigint not null references public.source_editions(id),
  source_record_id text not null check (btrim(source_record_id) <> ''),
  review_status text not null default 'reviewed' check (review_status in ('reviewed', 'candidate', 'rejected')),
  owner_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check (supporting_span_ref is not null or external_citation is not null),
  check (
    origin_mode <> 'algorithmically_calculated'
    or (derivation_method is not null and algorithm_version is not null)
  ),
  check (
    (origin_mode = 'user_authored' and owner_user_id is not null and epistemic_layer = 'user_interpretation')
    or (origin_mode <> 'user_authored' and owner_user_id is null)
  )
);

create index if not exists idx_entity_relationships_subject on public.entity_relationships (subject_entity_id, relation_type);
create index if not exists idx_entity_relationships_object on public.entity_relationships (object_entity_id, relation_type);
create index if not exists idx_entity_relationships_type on public.entity_relationships (relation_type);
create index if not exists idx_entity_relationships_verse on public.entity_relationships (supporting_verse_id) where supporting_verse_id is not null;
create index if not exists idx_entity_relationships_release on public.entity_relationships (source_release_id);
create index if not exists idx_entity_relationships_edition on public.entity_relationships (source_edition_id);
create index if not exists idx_entity_relationships_owner on public.entity_relationships (owner_user_id) where owner_user_id is not null;

-- ============================================================================
-- 9. ROW LEVEL SECURITY & LEAST-PRIVILEGE GRANTS
-- ============================================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'source_editions',
    'edition_passages',
    'versification_mappings',
    'lemmas',
    'lexeme_identifiers',
    'word_form_lemmas',
    'lexical_roots',
    'lemma_root_links',
    'lexical_senses',
    'token_morphemes',
    'syntax_nodes',
    'syntax_edges',
    'concept_properties',
    'concept_external_links',
    'relation_types',
    'canonical_entities'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = t || '_public_read'
    ) then
      execute format(
        'create policy %I on public.%I for select to anon, authenticated using (true)',
        t || '_public_read', t
      );
    end if;
  end loop;
end $$;

-- Semantic annotations & entity relationships separate public reviewed corpus
-- from private user-authored interpretations.
alter table public.semantic_annotations enable row level security;
revoke all on public.semantic_annotations from public, anon, authenticated;
grant select on public.semantic_annotations to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'semantic_annotations' and policyname = 'semantic_annotations_public_read'
  ) then
    create policy semantic_annotations_public_read on public.semantic_annotations
      for select to anon
      using (origin_mode <> 'user_authored' and review_status = 'reviewed');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'semantic_annotations' and policyname = 'semantic_annotations_owner_read'
  ) then
    create policy semantic_annotations_owner_read on public.semantic_annotations
      for select to authenticated
      using (
        (origin_mode <> 'user_authored' and review_status = 'reviewed')
        or (origin_mode = 'user_authored' and (select auth.uid()) = owner_user_id)
      );
  end if;
end $$;

alter table public.entity_relationships enable row level security;
revoke all on public.entity_relationships from public, anon, authenticated;
grant select on public.entity_relationships to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'entity_relationships' and policyname = 'entity_relationships_public_read'
  ) then
    create policy entity_relationships_public_read on public.entity_relationships
      for select to anon
      using (origin_mode <> 'user_authored' and review_status = 'reviewed');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'entity_relationships' and policyname = 'entity_relationships_owner_read'
  ) then
    create policy entity_relationships_owner_read on public.entity_relationships
      for select to authenticated
      using (
        (origin_mode <> 'user_authored' and review_status = 'reviewed')
        or (origin_mode = 'user_authored' and (select auth.uid()) = owner_user_id)
      );
  end if;
end $$;

notify pgrst, 'reload schema';
