-- CORP-01 Read-only static corpus export helper RPCs for deterministic keyset pagination
-- Exposes only approved public source-evidence tables and public Macula file manifest metadata.
-- Enforces field_is_enabled on macula_gated_field_values and never exposes user or private tables.

GRANT USAGE ON SCHEMA bible_internal TO anon, authenticated;
GRANT SELECT ON TABLE bible_internal.macula_syntax_import_files TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_static_corpus_manifest_meta_v1()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
SET statement_timeout = '30s'
AS $function$
  SELECT jsonb_build_object(
    'macula_syntax_import_files', COALESCE((
      SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id)
      FROM bible_internal.macula_syntax_import_files f
    ), '[]'::jsonb),
    'decode_grammar_catalog', COALESCE((
      SELECT jsonb_object_agg(g.grammar_code, public.decode_grammar_v1(g.grammar_code))
      FROM (
        SELECT DISTINCT grammar_code
        FROM public.verse_translation_sources
        WHERE grammar_code IS NOT NULL AND grammar_code <> ''
        UNION
        SELECT DISTINCT grammar_code
        FROM public.words
        WHERE grammar_code IS NOT NULL AND grammar_code <> ''
      ) g
    ), '{}'::jsonb)
  );
$function$;

REVOKE ALL ON FUNCTION public.get_static_corpus_manifest_meta_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_static_corpus_manifest_meta_v1() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.export_static_corpus_page_v1(
  p_table text,
  p_after_id bigint DEFAULT 0,
  p_after_sub bigint DEFAULT 0,
  p_limit integer DEFAULT 10000
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
SET statement_timeout = '30s'
AS $function$
DECLARE
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 10000), 1), 25000);
  v_rows jsonb := '[]'::jsonb;
BEGIN
  CASE p_table
    WHEN 'macula_hebrew_morphemes' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.macula_hebrew_morphemes WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'macula_greek_tokens' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.macula_greek_tokens WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'word_form_lemmas' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.word_form_lemmas WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'lxx_swete_words' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.lxx_swete_words WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'morphhb_tokens' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.morphhb_tokens WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'tagnt_tokens' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.tagnt_tokens WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'syntax_nodes_step' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.syntax_nodes WHERE tree_id IS NULL AND id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'syntax_edges_step' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (
        SELECT se.* FROM public.syntax_edges se
        JOIN public.syntax_nodes sn ON sn.id = se.target_node_id
        WHERE sn.tree_id IS NULL AND se.id > p_after_id
        ORDER BY se.id ASC LIMIT v_limit
      ) t;
    WHEN 'syntax_nodes_db' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.syntax_nodes WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'syntax_edges_db' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.syntax_edges WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'verse_translation_sources' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.verse_id, t.word_position), '[]'::jsonb) INTO v_rows
      FROM (
        SELECT * FROM public.verse_translation_sources
        WHERE (verse_id > p_after_id) OR (verse_id = p_after_id AND word_position > p_after_sub)
        ORDER BY verse_id ASC, word_position ASC
        LIMIT v_limit
      ) t;
    WHEN 'lexeme_identifiers' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.lexeme_identifiers WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'edition_passages' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.edition_passages WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'reader_rendering_groups' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.strongs_nr, t.label), '[]'::jsonb) INTO v_rows
      FROM (
        SELECT * FROM public.reader_rendering_groups
        ORDER BY strongs_nr ASC, label ASC
        OFFSET p_after_id LIMIT v_limit
      ) t;
    WHEN 'hebrew_lxx_verse_map' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.hebrew_lxx_verse_map WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'reader_english_verses' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.edition_id, t.book, t.chapter, t.verse_nr), '[]'::jsonb) INTO v_rows
      FROM (
        SELECT * FROM public.reader_english_verses
        ORDER BY edition_id ASC, book ASC, chapter ASC, verse_nr ASC
        OFFSET p_after_id LIMIT v_limit
      ) t;
    WHEN 'versification_mappings' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.versification_mappings WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'token_morphemes' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.token_morphemes WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'cross_token_mappings' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.cross_token_mappings WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'words_immutable' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (
        SELECT id, strongs_nr, grammar_code, original_word, transliteration, co_occurrences, english_translations, gematria
        FROM public.words
        WHERE id > p_after_id
        ORDER BY id ASC LIMIT v_limit
      ) t;
    WHEN 'words_full' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.words WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'verses_immutable' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (
        SELECT id, book, chapter, verse_nr, word_ids
        FROM public.verses
        WHERE id > p_after_id
        ORDER BY id ASC LIMIT v_limit
      ) t;
    WHEN 'verses_full' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.verses WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'books' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.books WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'lxx_swete_books' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.book_no), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.lxx_swete_books WHERE book_no > p_after_id ORDER BY book_no ASC LIMIT v_limit) t;
    WHEN 'lemmas' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.lemmas WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'lexemes' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.lexemes WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'lexical_senses' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.lexical_senses WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'lexical_roots' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.lexical_roots WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'lemma_root_links' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.lemma_root_links WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'lexical_formations' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.lexical_formations WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'lemma_components' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.lemma_components WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'lexical_connections' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.lexical_connections WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'canonical_entities' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.canonical_entities WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'entity_relationships' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.entity_relationships WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'hebrew_lxx_word_alignments' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.hebrew_lxx_word_alignments WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'macula_gated_field_values' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.morpheme_id, t.field_name), '[]'::jsonb) INTO v_rows
      FROM (
        SELECT * FROM public.macula_gated_field_values
        WHERE public.field_is_enabled('macula-hebrew', field_name)
        ORDER BY morpheme_id ASC, field_name ASC
        OFFSET p_after_id LIMIT v_limit
      ) t;
    WHEN 'source_releases' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.source_releases WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'source_editions' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.source_editions WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'field_license_registry' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.field_license_registry WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    WHEN 'reader_english_editions' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.reader_english_editions ORDER BY id ASC OFFSET p_after_id LIMIT v_limit) t;
    WHEN 'semantic_annotations' THEN
      SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id), '[]'::jsonb) INTO v_rows
      FROM (SELECT * FROM public.semantic_annotations WHERE id > p_after_id ORDER BY id ASC LIMIT v_limit) t;
    ELSE
      RAISE EXCEPTION 'Table % is not in the static corpus export allowlist', p_table USING ERRCODE = '22023';
  END CASE;

  RETURN v_rows;
END;
$function$;

REVOKE ALL ON FUNCTION public.export_static_corpus_page_v1(text, bigint, bigint, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.export_static_corpus_page_v1(text, bigint, bigint, integer) TO anon, authenticated, service_role;

-- ROLLBACK:
-- DROP FUNCTION IF EXISTS public.export_static_corpus_page_v1(text, bigint, bigint, integer);
-- DROP FUNCTION IF EXISTS public.get_static_corpus_manifest_meta_v1();
