-- Migration: 20261106133000_greek_passage_evidence_rpc.sql
-- Description: Deterministic lookup RPC for Greek New Testament verse evidence, TAGNT edition sets/variants, and MACULA Nestle1904 / SBLGNT tokens (F4)

CREATE OR REPLACE FUNCTION public.lookup_greek_verse_evidence_v1(
  p_book smallint,
  p_chapter smallint,
  p_verse smallint
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_verse_id integer;
  v_result jsonb;
BEGIN
  SELECT id INTO v_verse_id
  FROM public.verses
  WHERE book = p_book AND chapter = p_chapter AND verse_nr = p_verse;

  IF v_verse_id IS NULL THEN
    RETURN jsonb_build_object(
      'found', false,
      'book', p_book,
      'chapter', p_chapter,
      'verse_nr', p_verse,
      'error', 'Verse not found in canonical corpus'
    );
  END IF;

  WITH
  -- 1. Canonical verse info
  verse_info AS (
    SELECT
      v.id,
      v.book,
      b.name AS book_name,
      b.usfm AS book_usfm,
      v.chapter,
      v.verse_nr,
      v.word_ids
    FROM public.verses v
    JOIN public.books b ON b.id = v.book
    WHERE v.id = v_verse_id
  ),
  -- 2. STEP surface words
  step_words AS (
    SELECT
      COALESCE(jsonb_agg(
        jsonb_build_object(
          'word_id', w.id,
          'position', ord.pos,
          'original_word', w.original_word,
          'transliteration', w.transliteration,
          'strongs_nr', w.strongs_nr,
          'grammar_code', w.grammar_code,
          'gematria', w.gematria
        ) ORDER BY ord.pos
      ), '[]'::jsonb) AS words_json
    FROM verse_info vi
    CROSS JOIN LATERAL unnest(vi.word_ids) WITH ORDINALITY AS ord(wid, pos)
    JOIN public.words w ON w.id = ord.wid
  ),
  -- 3. STEP TAGNT tokens with edition sets and variants
  tagnt_data AS (
    SELECT
      COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', tt.id,
          'tagnt_id', tt.tagnt_id,
          'word_type', tt.word_type,
          'surface_greek', tt.surface_greek,
          'transliteration', tt.transliteration,
          'english_translation', tt.english_translation,
          'dstrongs', tt.dstrongs,
          'grammar_code', tt.grammar_code,
          'lemma', tt.lemma,
          'step_gloss', tt.step_gloss,
          'editions', tt.editions,
          'meaning_variants', tt.meaning_variants,
          'spelling_variants', tt.spelling_variants,
          'sub_meaning', tt.sub_meaning,
          'conjoin_word', tt.conjoin_word,
          'sstrong_instance', tt.sstrong_instance,
          'alt_strongs', tt.alt_strongs,
          'word_position', tt.word_position,
          'step_word_id', tt.step_word_id,
          'link_status', tt.link_status
        ) ORDER BY tt.word_position, tt.id
      ), '[]'::jsonb) AS tagnt_json,
      count(*) FILTER (WHERE tt.word_type ILIKE 'K%') AS traditional_only_count,
      count(*) FILTER (WHERE tt.word_type ILIKE 'N%' AND tt.word_type NOT ILIKE '%K%') AS critical_only_count,
      count(*) FILTER (WHERE tt.meaning_variants IS NOT NULL AND tt.meaning_variants <> '') AS meaning_variants_count,
      count(*) FILTER (WHERE tt.spelling_variants IS NOT NULL AND tt.spelling_variants <> '') AS spelling_variants_count
    FROM public.tagnt_tokens tt
    WHERE tt.canonical_verse_id = v_verse_id
  ),
  -- 4. MACULA Greek Nestle 1904 tokens
  nestle_data AS (
    SELECT
      COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', nt.id,
          'xml_id', nt.xml_id,
          'ref_nt', nt.ref_nt,
          'word_no', nt.word_no,
          'role', nt.role,
          'part_of_speech', nt.part_of_speech,
          'word_type', nt.word_type,
          'text_form', nt.text_form,
          'after_text', nt.after_text,
          'lemma', nt.lemma,
          'normalized', nt.normalized,
          'strongs', nt.strongs,
          'morph_code', nt.morph_code,
          'person', nt.person,
          'number', nt.number,
          'gender', nt.gender,
          'case_value', nt.case_value,
          'tense', nt.tense,
          'voice', nt.voice,
          'mood', nt.mood,
          'degree', nt.degree,
          'gloss', nt.gloss,
          'english', nt.english,
          'mandarin', nt.mandarin,
          'frame', nt.frame,
          'subjref', nt.subjref,
          'referent', nt.referent,
          'step_word_id', nt.step_word_id,
          'link_status', nt.link_status
        ) ORDER BY nt.word_no, nt.id
      ), '[]'::jsonb) AS nestle_json,
      count(*) AS nestle_count
    FROM public.macula_greek_tokens nt
    WHERE nt.canonical_verse_id = v_verse_id
      AND nt.edition_key = 'macula-greek-nestle1904'
  ),
  -- 5. MACULA Greek SBLGNT tokens
  sblgnt_data AS (
    SELECT
      COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', st.id,
          'xml_id', st.xml_id,
          'ref_nt', st.ref_nt,
          'word_no', st.word_no,
          'role', st.role,
          'part_of_speech', st.part_of_speech,
          'word_type', st.word_type,
          'text_form', st.text_form,
          'after_text', st.after_text,
          'lemma', st.lemma,
          'normalized', st.normalized,
          'strongs', st.strongs,
          'morph_code', st.morph_code,
          'person', st.person,
          'number', st.number,
          'gender', st.gender,
          'case_value', st.case_value,
          'tense', st.tense,
          'voice', st.voice,
          'mood', st.mood,
          'degree', st.degree,
          'gloss', st.gloss,
          'english', st.english,
          'mandarin', st.mandarin,
          'frame', st.frame,
          'subjref', st.subjref,
          'referent', st.referent,
          'step_word_id', st.step_word_id,
          'link_status', st.link_status
        ) ORDER BY st.word_no, st.id
      ), '[]'::jsonb) AS sblgnt_json,
      count(*) AS sblgnt_count
    FROM public.macula_greek_tokens st
    WHERE st.canonical_verse_id = v_verse_id
      AND st.edition_key = 'macula-greek-sblgnt'
  ),
  -- 6. Edition comparison (Nestle1904 vs SBLGNT textual differences)
  edition_diffs AS (
    SELECT
      COALESCE(jsonb_agg(
        jsonb_build_object(
          'word_no', n.word_no,
          'nestle_text', n.text_form,
          'sblgnt_text', s.text_form,
          'nestle_morph', n.morph_code,
          'sblgnt_morph', s.morph_code,
          'nestle_lemma', n.lemma,
          'sblgnt_lemma', s.lemma
        ) ORDER BY n.word_no
      ), '[]'::jsonb) AS diffs_json,
      count(*) AS diffs_count
    FROM public.macula_greek_tokens n
    JOIN public.macula_greek_tokens s
      ON s.canonical_verse_id = n.canonical_verse_id
     AND s.edition_key = 'macula-greek-sblgnt'
     AND s.word_no = n.word_no
    WHERE n.canonical_verse_id = v_verse_id
      AND n.edition_key = 'macula-greek-nestle1904'
      AND (n.text_form <> s.text_form OR n.morph_code <> s.morph_code OR n.lemma <> s.lemma)
  )
  SELECT jsonb_build_object(
    'found', true,
    'verse', (SELECT row_to_json(vi.*) FROM verse_info vi),
    'step_tokens', sw.words_json,
    'tagnt_tokens', td.tagnt_json,
    'macula_nestle1904_tokens', nd.nestle_json,
    'macula_sblgnt_tokens', sd.sblgnt_json,
    'edition_differences', ed.diffs_json,
    'summary', jsonb_build_object(
      'total_step_tokens', COALESCE(jsonb_array_length(sw.words_json), 0),
      'total_tagnt_tokens', COALESCE(jsonb_array_length(td.tagnt_json), 0),
      'total_nestle_tokens', COALESCE(nd.nestle_count, 0),
      'total_sblgnt_tokens', COALESCE(sd.sblgnt_count, 0),
      'traditional_only_count', COALESCE(td.traditional_only_count, 0),
      'critical_only_count', COALESCE(td.critical_only_count, 0),
      'meaning_variants_count', COALESCE(td.meaning_variants_count, 0),
      'spelling_variants_count', COALESCE(td.spelling_variants_count, 0),
      'edition_differences_count', COALESCE(ed.diffs_count, 0),
      'has_textual_variants', (
        COALESCE(td.traditional_only_count, 0) > 0 OR
        COALESCE(td.critical_only_count, 0) > 0 OR
        COALESCE(td.meaning_variants_count, 0) > 0 OR
        COALESCE(ed.diffs_count, 0) > 0
      )
    )
  )
  INTO v_result
  FROM verse_info vi
  CROSS JOIN step_words sw
  CROSS JOIN tagnt_data td
  CROSS JOIN nestle_data nd
  CROSS JOIN sblgnt_data sd
  CROSS JOIN edition_diffs ed;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_greek_verse_evidence_v1(smallint, smallint, smallint) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
