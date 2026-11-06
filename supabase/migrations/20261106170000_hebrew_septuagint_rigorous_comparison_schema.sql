-- Migration: 20261106170000_hebrew_septuagint_rigorous_comparison_schema.sql
-- Description: Additive schema for rigorous Hebrew-Septuagint comparison, TVTMS versification support, and 3-tier word/phrase alignments.

-- 1. Extend hebrew_lxx_verse_map to support unmatched passages (omissions/additions)
ALTER TABLE public.hebrew_lxx_verse_map DROP CONSTRAINT IF EXISTS chk_hebrew_lxx_map_kind;

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
    'reordered',
    'unmatched_hebrew',
    'unmatched_septuagint'
  ));

-- Allow nullability for one-sided unmatched verses
ALTER TABLE public.hebrew_lxx_verse_map ALTER COLUMN canonical_verse_id DROP NOT NULL;
ALTER TABLE public.hebrew_lxx_verse_map ALTER COLUMN lxx_book_no DROP NOT NULL;
ALTER TABLE public.hebrew_lxx_verse_map ALTER COLUMN lxx_chapter DROP NOT NULL;
ALTER TABLE public.hebrew_lxx_verse_map ALTER COLUMN lxx_verse_nr DROP NOT NULL;

-- 2. Create public.hebrew_lxx_word_alignments with strict 3-tier separation
CREATE TABLE IF NOT EXISTS public.hebrew_lxx_word_alignments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alignment_key text NOT NULL UNIQUE,
  canonical_verse_id integer REFERENCES public.verses(id),
  lxx_book_no smallint REFERENCES public.lxx_swete_books(book_no),
  lxx_chapter smallint NOT NULL,
  lxx_chapter_suffix text NOT NULL DEFAULT '',
  lxx_verse_nr smallint NOT NULL,
  lxx_verse_suffix text NOT NULL DEFAULT '',

  -- Hebrew side (supports 1:many or many:1)
  hebrew_word_ids integer[] NOT NULL DEFAULT '{}',
  hebrew_token_ordinals smallint[] NOT NULL DEFAULT '{}',
  hebrew_text text NOT NULL,
  hebrew_strongs text[] NOT NULL DEFAULT '{}',

  -- Greek (LXX) side (supports 1:many or many:1)
  lxx_word_ids bigint[] NOT NULL DEFAULT '{}',
  lxx_token_ordinals smallint[] NOT NULL DEFAULT '{}',
  lxx_text text NOT NULL,
  lxx_strongs text[] NOT NULL DEFAULT '{}',

  -- Alignment cardinality & classification
  cardinality text NOT NULL CHECK (cardinality IN ('one_to_one', 'one_to_many', 'many_to_one', 'many_to_many', 'unmatched_hebrew', 'unmatched_septuagint')),

  -- Strict 3-Tier Classification
  alignment_tier text NOT NULL CHECK (alignment_tier IN (
    'documented_textual',                 -- Tier 1: Source-attested textual/lexical alignment
    'computationally_inferred_candidate', -- Tier 2: Algorithmic candidate alignment
    'scholarly_interpretation'            -- Tier 3: Critical apparatus / commentary
  )),

  -- Verification status
  verification_status text NOT NULL CHECK (verification_status IN (
    'verified_source_attestation',
    'unverified_candidate',
    'scholarly_hypothesis'
  )),

  -- Database-Native Epistemic Invariant: Candidate alignments can NEVER masquerade as verified!
  CONSTRAINT chk_candidate_never_masquerade CHECK (
    (alignment_tier = 'documented_textual' AND verification_status = 'verified_source_attestation' AND (confidence_score IS NULL OR confidence_score = 1.0))
    OR (alignment_tier = 'computationally_inferred_candidate' AND verification_status = 'unverified_candidate' AND confidence_score < 1.0)
    OR (alignment_tier = 'scholarly_interpretation' AND verification_status = 'scholarly_hypothesis')
  ),

  confidence_score numeric(4,3),      -- e.g. 0.850 for candidate, 1.000 for verified
  algorithm_or_source text NOT NULL,  -- e.g. 'Clear-Bible/macula-hebrew', 'STEPBible TVTMS', 'lemma_strong_exact_v1', 'tov_polak_catss'
  translation_technique text,         -- e.g. 'literal', 'free_paraphrastic', 'idiomatic', 'untranslated_particle', 'conjectural'
  evidence_summary text NOT NULL,

  source_release_id bigint REFERENCES public.source_releases(id),
  source_record_id text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Indexes for hebrew_lxx_word_alignments
CREATE INDEX IF NOT EXISTS idx_hebrew_lxx_align_verse
  ON public.hebrew_lxx_word_alignments (canonical_verse_id);

CREATE INDEX IF NOT EXISTS idx_hebrew_lxx_align_lxx_ref
  ON public.hebrew_lxx_word_alignments (lxx_book_no, lxx_chapter, lxx_verse_nr);

CREATE INDEX IF NOT EXISTS idx_hebrew_lxx_align_tier
  ON public.hebrew_lxx_word_alignments (alignment_tier);

CREATE INDEX IF NOT EXISTS idx_hebrew_lxx_align_heb_words
  ON public.hebrew_lxx_word_alignments USING gin (hebrew_word_ids);

CREATE INDEX IF NOT EXISTS idx_hebrew_lxx_align_lxx_words
  ON public.hebrew_lxx_word_alignments USING gin (lxx_word_ids);

-- Enable RLS
ALTER TABLE public.hebrew_lxx_word_alignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read-only hebrew_lxx_word_alignments" ON public.hebrew_lxx_word_alignments;
CREATE POLICY "Public read-only hebrew_lxx_word_alignments"
  ON public.hebrew_lxx_word_alignments
  FOR SELECT
  TO public
  USING (true);

-- Revoke public writes
REVOKE INSERT, UPDATE, DELETE ON public.hebrew_lxx_word_alignments FROM public, anon, authenticated;

-- 3. Batch Ingestion RPC for hebrew_lxx_word_alignments
CREATE OR REPLACE FUNCTION public.ingest_hebrew_lxx_word_alignments_batch_v1(
  p_alignments jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted integer := 0;
BEGIN
  INSERT INTO public.hebrew_lxx_word_alignments (
    alignment_key,
    canonical_verse_id,
    lxx_book_no,
    lxx_chapter,
    lxx_chapter_suffix,
    lxx_verse_nr,
    lxx_verse_suffix,
    hebrew_word_ids,
    hebrew_token_ordinals,
    hebrew_text,
    hebrew_strongs,
    lxx_word_ids,
    lxx_token_ordinals,
    lxx_text,
    lxx_strongs,
    cardinality,
    alignment_tier,
    verification_status,
    confidence_score,
    algorithm_or_source,
    translation_technique,
    evidence_summary,
    source_release_id,
    source_record_id
  )
  SELECT
    (a->>'alignment_key')::text,
    (a->>'canonical_verse_id')::integer,
    (a->>'lxx_book_no')::smallint,
    (a->>'lxx_chapter')::smallint,
    coalesce(a->>'lxx_chapter_suffix', '')::text,
    (a->>'lxx_verse_nr')::smallint,
    coalesce(a->>'lxx_verse_suffix', '')::text,
    coalesce((SELECT array_agg(elem::integer) FROM jsonb_array_elements_text(a->'hebrew_word_ids') elem), '{}'::integer[]),
    coalesce((SELECT array_agg(elem::smallint) FROM jsonb_array_elements_text(a->'hebrew_token_ordinals') elem), '{}'::smallint[]),
    (a->>'hebrew_text')::text,
    coalesce((SELECT array_agg(elem::text) FROM jsonb_array_elements_text(a->'hebrew_strongs') elem), '{}'::text[]),
    coalesce((SELECT array_agg(elem::bigint) FROM jsonb_array_elements_text(a->'lxx_word_ids') elem), '{}'::bigint[]),
    coalesce((SELECT array_agg(elem::smallint) FROM jsonb_array_elements_text(a->'lxx_token_ordinals') elem), '{}'::smallint[]),
    (a->>'lxx_text')::text,
    coalesce((SELECT array_agg(elem::text) FROM jsonb_array_elements_text(a->'lxx_strongs') elem), '{}'::text[]),
    (a->>'cardinality')::text,
    (a->>'alignment_tier')::text,
    (a->>'verification_status')::text,
    (a->>'confidence_score')::numeric,
    (a->>'algorithm_or_source')::text,
    a->>'translation_technique',
    (a->>'evidence_summary')::text,
    (a->>'source_release_id')::bigint,
    coalesce(a->>'source_record_id', '')::text
  FROM jsonb_array_elements(p_alignments) AS a
  ON CONFLICT (alignment_key) DO UPDATE SET
    canonical_verse_id = EXCLUDED.canonical_verse_id,
    lxx_book_no = EXCLUDED.lxx_book_no,
    lxx_chapter = EXCLUDED.lxx_chapter,
    lxx_chapter_suffix = EXCLUDED.lxx_chapter_suffix,
    lxx_verse_nr = EXCLUDED.lxx_verse_nr,
    lxx_verse_suffix = EXCLUDED.lxx_verse_suffix,
    hebrew_word_ids = EXCLUDED.hebrew_word_ids,
    hebrew_token_ordinals = EXCLUDED.hebrew_token_ordinals,
    hebrew_text = EXCLUDED.hebrew_text,
    hebrew_strongs = EXCLUDED.hebrew_strongs,
    lxx_word_ids = EXCLUDED.lxx_word_ids,
    lxx_token_ordinals = EXCLUDED.lxx_token_ordinals,
    lxx_text = EXCLUDED.lxx_text,
    lxx_strongs = EXCLUDED.lxx_strongs,
    cardinality = EXCLUDED.cardinality,
    alignment_tier = EXCLUDED.alignment_tier,
    verification_status = EXCLUDED.verification_status,
    confidence_score = EXCLUDED.confidence_score,
    algorithm_or_source = EXCLUDED.algorithm_or_source,
    translation_technique = EXCLUDED.translation_technique,
    evidence_summary = EXCLUDED.evidence_summary,
    source_release_id = EXCLUDED.source_release_id,
    source_record_id = EXCLUDED.source_record_id;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN jsonb_build_object(
    'status', 'success',
    'inserted', v_inserted
  );
END;
$$;

-- Restrict execution to postgres/service_role
REVOKE EXECUTE ON FUNCTION public.ingest_hebrew_lxx_word_alignments_batch_v1(jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_hebrew_lxx_word_alignments_batch_v1(jsonb) TO service_role;
