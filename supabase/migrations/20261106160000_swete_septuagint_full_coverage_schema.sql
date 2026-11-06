-- supabase/migrations/20261106160000_swete_septuagint_full_coverage_schema.sql
-- F7: Extend Swete Septuagint schema for complete coverage across all 55 books,
-- stored search normalization (distinct from raw Unicode), chapter suffixes (prologues/sub-chapters),
-- and atomic batch ingestion RPCs.

BEGIN;

-- 1. Extend public.lxx_swete_words with chapter_suffix and normalized_word
ALTER TABLE public.lxx_swete_words
  ADD COLUMN IF NOT EXISTS chapter_suffix text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS normalized_word text;

-- 2. Populate normalized_word for any existing rows using public.strip_greek_diacritics
UPDATE public.lxx_swete_words
SET normalized_word = public.strip_greek_diacritics(word_text)
WHERE normalized_word IS NULL;

-- 3. Update Unique Constraint on public.lxx_swete_words to include chapter_suffix
ALTER TABLE public.lxx_swete_words
  DROP CONSTRAINT IF EXISTS lxx_swete_words_book_no_chapter_verse_nr_verse_suffix_ordin_key;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_lxx_swete_words_position'
  ) THEN
    ALTER TABLE public.lxx_swete_words
      ADD CONSTRAINT uq_lxx_swete_words_position
      UNIQUE (book_no, chapter, chapter_suffix, verse_nr, verse_suffix, ordinal);
  END IF;
END $$;

-- 4. Extend public.hebrew_lxx_verse_map with lxx_chapter_suffix
ALTER TABLE public.hebrew_lxx_verse_map
  ADD COLUMN IF NOT EXISTS lxx_chapter_suffix text NOT NULL DEFAULT '';

-- 5. Harmonize mapping_kind check constraint on public.hebrew_lxx_verse_map
ALTER TABLE public.hebrew_lxx_verse_map
  DROP CONSTRAINT IF EXISTS chk_hebrew_lxx_map_kind,
  DROP CONSTRAINT IF EXISTS hebrew_lxx_verse_map_mapping_kind_check;

ALTER TABLE public.hebrew_lxx_verse_map
  ADD CONSTRAINT chk_hebrew_lxx_map_kind
  CHECK (mapping_kind IN (
    'same_reference',
    'psalm_numbering_shift',
    'versification_shift',
    'superscription_title_verse',
    'fragment_subdivision',
    'lxx_plus',
    'mt_plus',
    'reordered'
  ));

-- Update unique constraint on hebrew_lxx_verse_map
ALTER TABLE public.hebrew_lxx_verse_map
  DROP CONSTRAINT IF EXISTS uq_hebrew_lxx_verse_map;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_hebrew_lxx_verse_map_full'
  ) THEN
    ALTER TABLE public.hebrew_lxx_verse_map
      ADD CONSTRAINT uq_hebrew_lxx_verse_map_full
      UNIQUE (canonical_verse_id, lxx_book_no, lxx_chapter, lxx_chapter_suffix, lxx_verse_nr, lxx_verse_suffix);
  END IF;
END $$;

-- 6. Indexes for rapid lookup and search
CREATE INDEX IF NOT EXISTS idx_lxx_swete_words_ref
  ON public.lxx_swete_words (book_no, chapter, chapter_suffix, verse_nr, verse_suffix);

CREATE INDEX IF NOT EXISTS idx_lxx_swete_words_normalized
  ON public.lxx_swete_words (normalized_word);

CREATE INDEX IF NOT EXISTS idx_hebrew_lxx_verse_map_lxx_ref
  ON public.hebrew_lxx_verse_map (lxx_book_no, lxx_chapter, lxx_chapter_suffix, lxx_verse_nr, lxx_verse_suffix);

-- 7. Batch Ingestion RPC for Swete Septuagint Words
CREATE OR REPLACE FUNCTION public.ingest_swete_words_batch_v1(
  p_words jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted integer := 0;
  v_default_release_id bigint;
  v_default_edition_id bigint;
BEGIN
  -- Resolve default release and edition if not provided per row
  SELECT id INTO v_default_release_id
  FROM public.source_releases
  WHERE release_key = 'lxx-swete-26bad3e'
  LIMIT 1;

  SELECT id INTO v_default_edition_id
  FROM public.source_editions
  WHERE edition_key = 'lxx-swete'
  LIMIT 1;

  WITH ins AS (
    INSERT INTO public.lxx_swete_words (
      book_no,
      chapter,
      chapter_suffix,
      verse_nr,
      verse_suffix,
      ordinal,
      word_text,
      normalized_word,
      source_record_id,
      source_release_id,
      source_edition_id
    )
    SELECT
      (elem->>'book_no')::smallint,
      (elem->>'chapter')::smallint,
      COALESCE(elem->>'chapter_suffix', ''),
      (elem->>'verse_nr')::smallint,
      COALESCE(elem->>'verse_suffix', ''),
      (elem->>'ordinal')::integer,
      (elem->>'word_text')::text,
      COALESCE(
        elem->>'normalized_word',
        public.strip_greek_diacritics((elem->>'word_text')::text)
      ),
      (elem->>'source_record_id')::text,
      COALESCE((elem->>'source_release_id')::bigint, v_default_release_id),
      COALESCE((elem->>'source_edition_id')::bigint, v_default_edition_id)
    FROM jsonb_array_elements(p_words) AS elem
    ON CONFLICT (book_no, chapter, chapter_suffix, verse_nr, verse_suffix, ordinal)
    DO UPDATE SET
      word_text = EXCLUDED.word_text,
      normalized_word = EXCLUDED.normalized_word,
      source_record_id = EXCLUDED.source_record_id,
      source_release_id = EXCLUDED.source_release_id,
      source_edition_id = EXCLUDED.source_edition_id
    RETURNING id
  )
  SELECT count(*) INTO v_inserted FROM ins;

  RETURN jsonb_build_object(
    'status', 'success',
    'inserted_count', v_inserted
  );
END;
$$;

-- 8. Batch Ingestion RPC for Hebrew (MT) <-> LXX Verse Mappings
CREATE OR REPLACE FUNCTION public.ingest_hebrew_lxx_mappings_batch_v1(
  p_mappings jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted integer := 0;
  v_default_release_id bigint;
BEGIN
  SELECT id INTO v_default_release_id
  FROM public.source_releases
  WHERE release_key = 'lxx-swete-26bad3e'
  LIMIT 1;

  WITH ins AS (
    INSERT INTO public.hebrew_lxx_verse_map (
      canonical_verse_id,
      lxx_book_no,
      lxx_chapter,
      lxx_chapter_suffix,
      lxx_verse_nr,
      lxx_verse_suffix,
      mapping_kind,
      rule_citation,
      origin_mode,
      derivation_method,
      algorithm_version,
      source_release_id,
      source_record_id
    )
    SELECT
      (elem->>'canonical_verse_id')::integer,
      (elem->>'lxx_book_no')::smallint,
      (elem->>'lxx_chapter')::smallint,
      COALESCE(elem->>'lxx_chapter_suffix', ''),
      (elem->>'lxx_verse_nr')::smallint,
      COALESCE(elem->>'lxx_verse_suffix', ''),
      (elem->>'mapping_kind')::text,
      (elem->>'rule_citation')::text,
      COALESCE(elem->>'origin_mode', 'algorithmically_calculated')::text,
      COALESCE(elem->>'derivation_method', 'mt_lxx_reference_alignment')::text,
      COALESCE(elem->>'algorithm_version', '1.0.0')::text,
      COALESCE((elem->>'source_release_id')::bigint, v_default_release_id),
      (elem->>'source_record_id')::text
    FROM jsonb_array_elements(p_mappings) AS elem
    ON CONFLICT (canonical_verse_id, lxx_book_no, lxx_chapter, lxx_chapter_suffix, lxx_verse_nr, lxx_verse_suffix)
    DO UPDATE SET
      mapping_kind = EXCLUDED.mapping_kind,
      rule_citation = EXCLUDED.rule_citation,
      derivation_method = EXCLUDED.derivation_method,
      algorithm_version = EXCLUDED.algorithm_version,
      source_record_id = EXCLUDED.source_record_id
    RETURNING id
  )
  SELECT count(*) INTO v_inserted FROM ins;

  RETURN jsonb_build_object(
    'status', 'success',
    'inserted_count', v_inserted
  );
END;
$$;

-- 9. Permissions & PostgREST Schema Reload
GRANT EXECUTE ON FUNCTION public.ingest_swete_words_batch_v1(jsonb) TO anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.ingest_hebrew_lxx_mappings_batch_v1(jsonb) TO anon, authenticated, service_role, postgres;

COMMIT;

NOTIFY pgrst, 'reload schema';
