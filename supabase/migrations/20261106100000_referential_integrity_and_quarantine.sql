-- Migration: 20261106100000_referential_integrity_and_quarantine.sql
-- Description: Strengthen referential integrity, enforce provenance constraints, and deploy quarantine table (F2)

-- 1. Create Quarantine Table for Unresolved Evidence Records
CREATE TABLE IF NOT EXISTS public.quarantined_evidence_records (
  id bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  dataset_key text NOT NULL,
  source_edition_id bigint REFERENCES public.source_editions(id),
  source_record_id text NOT NULL,
  entity_type text NOT NULL,
  raw_payload jsonb NOT NULL,
  quarantine_reason text NOT NULL,
  quarantine_status text NOT NULL DEFAULT 'unresolved' 
    CHECK (quarantine_status IN ('unresolved', 'reviewed_invalid', 'resolved')),
  quarantined_at timestamptz NOT NULL DEFAULT now(),
  resolution_notes text
);

CREATE INDEX IF NOT EXISTS idx_quarantined_records_dataset ON public.quarantined_evidence_records(dataset_key);
CREATE INDEX IF NOT EXISTS idx_quarantined_records_status ON public.quarantined_evidence_records(quarantine_status);

ALTER TABLE public.quarantined_evidence_records ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.quarantined_evidence_records FROM anon, authenticated, public;
GRANT SELECT ON public.quarantined_evidence_records TO anon, authenticated;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'quarantined_evidence_records' AND policyname = 'p_quarantined_select'
  ) THEN
    CREATE POLICY p_quarantined_select ON public.quarantined_evidence_records FOR SELECT USING (true);
  END IF;
END $$;

GRANT SELECT ON public.quarantined_evidence_records TO anon, authenticated;
COMMENT ON TABLE public.quarantined_evidence_records IS 'Quarantine area for imported linguistic/biblical records with ambiguous, disputed, or unresolved referential mappings.';

-- 2. Enforce Direct Provenance Columns on lxx_swete_words
ALTER TABLE public.lxx_swete_words ADD COLUMN IF NOT EXISTS source_release_id bigint REFERENCES public.source_releases(id);
ALTER TABLE public.lxx_swete_words ADD COLUMN IF NOT EXISTS source_edition_id bigint REFERENCES public.source_editions(id);

-- Populate direct provenance from parent lxx_swete_books metadata
UPDATE public.lxx_swete_words w
SET source_release_id = b.source_release_id,
    source_edition_id = b.source_edition_id
FROM public.lxx_swete_books b
WHERE b.book_no = w.book_no AND (w.source_release_id IS NULL OR w.source_edition_id IS NULL);

CREATE INDEX IF NOT EXISTS idx_lxx_swete_words_source_edition ON public.lxx_swete_words(source_edition_id);

-- 3. Domain and Referential Check Constraints on Linguistic Tables

-- A. lexical_roots
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_lexical_roots_kind') THEN
    ALTER TABLE public.lexical_roots ADD CONSTRAINT chk_lexical_roots_kind
      CHECK (root_kind IN ('documented_lexical_base', 'semitic_cross_dialect_base', 'greek_etymological_stem'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_lexical_roots_language') THEN
    ALTER TABLE public.lexical_roots ADD CONSTRAINT chk_lexical_roots_language
      CHECK (language IN ('hbo', 'arc', 'grc'));
  END IF;
END $$;

-- B. lemma_root_links
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_lemma_root_links_no_synonymy') THEN
    ALTER TABLE public.lemma_root_links ADD CONSTRAINT chk_lemma_root_links_no_synonymy
      CHECK (implies_synonymy = false);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_lemma_root_links_etymology') THEN
    ALTER TABLE public.lemma_root_links ADD CONSTRAINT chk_lemma_root_links_etymology
      CHECK (etymology_type IN (
        'form_of', 'aramaic_cognate_of', 'base_root_anchor', 'compound_part_of',
        'group_member_of', 'shared_name_base', 'greek_loan_or_transliteration',
        'hebrew_cognate_of', 'derived_from', 'spelling_variant_of'
      ));
  END IF;
END $$;

-- C. lemmas & lexemes language consistency
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_lemmas_language') THEN
    ALTER TABLE public.lemmas ADD CONSTRAINT chk_lemmas_language
      CHECK (language IN ('hbo', 'arc', 'grc'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_lexemes_language') THEN
    ALTER TABLE public.lexemes ADD CONSTRAINT chk_lexemes_language
      CHECK (language IN ('hbo', 'arc', 'grc'));
  END IF;
END $$;

-- D. lexical_senses order
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_lexical_senses_order') THEN
    ALTER TABLE public.lexical_senses ADD CONSTRAINT chk_lexical_senses_order
      CHECK (sense_order > 0);
  END IF;
END $$;

-- E. hebrew_lxx_verse_map
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_hebrew_lxx_map_kind') THEN
    ALTER TABLE public.hebrew_lxx_verse_map ADD CONSTRAINT chk_hebrew_lxx_map_kind
      CHECK (mapping_kind IN ('same_reference', 'versification_shift', 'superscription_title_verse', 'fragment_subdivision'));
  END IF;
END $$;

-- F. macula_hebrew_morphemes
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_macula_link_status') THEN
    ALTER TABLE public.macula_hebrew_morphemes ADD CONSTRAINT chk_macula_link_status
      CHECK (link_status IN ('matched_consonantal', 'unmatched', 'quarantined', 'variant_reading'));
  END IF;
END $$;

-- G. entity_relationships: no self-relationships
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_entity_relationships_no_self_ref') THEN
    ALTER TABLE public.entity_relationships ADD CONSTRAINT chk_entity_relationships_no_self_ref
      CHECK (subject_entity_id <> object_entity_id);
  END IF;
END $$;

-- H. token_morphemes: valid morpheme roles
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_token_morphemes_role') THEN
    ALTER TABLE public.token_morphemes ADD CONSTRAINT chk_token_morphemes_role
      CHECK (morpheme_role IN ('stem', 'prefix_particle', 'prefix_preposition', 'prefix_conjunction', 'prefix_article', 'pronominal_suffix'));
  END IF;
END $$;
