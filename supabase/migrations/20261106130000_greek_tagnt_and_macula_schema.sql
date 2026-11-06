-- Migration: 20261106130000_greek_tagnt_and_macula_schema.sql
-- Description: Additive schema for STEP TAGNT and MACULA Greek NT (Nestle 1904 & SBLGNT) integration (F4)

-- 1. Register Greek NT source editions
DO $$
DECLARE
  v_step_release_id bigint;
  v_macula_release_id bigint;
BEGIN
  SELECT id INTO v_step_release_id FROM public.source_releases WHERE release_key = 'stepbible-2026-11';
  SELECT id INTO v_macula_release_id FROM public.source_releases WHERE release_key = 'macula-greek-8423afe';

  -- Register MACULA Greek Nestle 1904 edition
  IF NOT EXISTS (SELECT 1 FROM public.source_editions WHERE edition_key = 'macula-greek-nestle1904') THEN
    INSERT INTO public.source_editions (
      edition_key, source_release_id, edition_kind, title, language,
      testament_scope, versification_scheme, license, licensing_notes, source_url
    ) VALUES (
      'macula-greek-nestle1904', v_macula_release_id, 'greek_text',
      'MACULA Greek Linguistic Treebank (Nestle 1904)', 'grc', 'NT', 'greek_eclectic',
      'CC BY 4.0', 'MACULA Greek Nestle 1904 text, morphology, glosses, syntax frames, and participant referents.',
      'https://github.com/Clear-Bible/macula-greek'
    );
  END IF;

  -- Register MACULA Greek SBLGNT edition
  IF NOT EXISTS (SELECT 1 FROM public.source_editions WHERE edition_key = 'macula-greek-sblgnt') THEN
    INSERT INTO public.source_editions (
      edition_key, source_release_id, edition_kind, title, language,
      testament_scope, versification_scheme, license, licensing_notes, source_url
    ) VALUES (
      'macula-greek-sblgnt', v_macula_release_id, 'greek_text',
      'MACULA Greek Linguistic Treebank (SBLGNT)', 'grc', 'NT', 'greek_eclectic',
      'CC BY 4.0', 'MACULA Greek SBLGNT text, morphology, glosses, syntax frames, and participant referents.',
      'https://github.com/Clear-Bible/macula-greek'
    );
  END IF;

  -- Register STEP TAGNT Amalgamated edition
  IF NOT EXISTS (SELECT 1 FROM public.source_editions WHERE edition_key = 'step-tagnt-amalgamated') THEN
    INSERT INTO public.source_editions (
      edition_key, source_release_id, edition_kind, title, language,
      testament_scope, versification_scheme, license, licensing_notes, source_url
    ) VALUES (
      'step-tagnt-amalgamated', v_step_release_id, 'greek_text',
      'STEPBible TAGNT (Translators Amalgamated Greek New Testament)', 'grc', 'NT', 'greek_eclectic',
      'CC BY 4.0', 'All words from standard Greek editions (NA27/28, TR, SBL, TH, Byz, WH, Treg) with translations, grammar, sources & variants.',
      'https://github.com/STEPBible/STEPBible-Data'
    );
  END IF;
END $$;

-- 2. Register field licenses for macula-greek
INSERT INTO public.field_license_registry (dataset_key, field_name, field_group, origin, license, status, decision_note, decided_at)
VALUES
  ('macula-greek', 'text', 'lexical_text', 'Nestle1904 / SBLGNT', 'CC BY 4.0', 'enabled', 'Original Greek surface text with full diacritics', now()),
  ('macula-greek', 'after', 'lexical_text', 'Nestle1904 / SBLGNT', 'CC BY 4.0', 'enabled', 'Trailing whitespace and punctuation', now()),
  ('macula-greek', 'lemma', 'lexical_entry', 'Clear-Bible', 'CC BY 4.0', 'enabled', 'Canonical Greek headword lemma with diacritics', now()),
  ('macula-greek', 'normalized', 'lexical_entry', 'Clear-Bible', 'CC BY 4.0', 'enabled', 'Normalized Greek token representation', now()),
  ('macula-greek', 'strong', 'lexical_id', 'James Strong / STEP', 'CC BY 4.0', 'enabled', 'Greek Strongs identifier', now()),
  ('macula-greek', 'morph', 'morphology', 'Tauber / Tyndale', 'CC BY 4.0', 'enabled', 'Canonical Greek morphological code (e.g. N-NSF, V-PAI-3S)', now()),
  ('macula-greek', 'gloss', 'gloss', 'Clear-Bible', 'CC BY 4.0', 'enabled', 'Contextual translation gloss', now()),
  ('macula-greek', 'english', 'gloss', 'Berean / Clear', 'CC BY 4.0', 'enabled', 'English translation label', now()),
  ('macula-greek', 'mandarin', 'gloss', 'Clear-Bible', 'CC BY 4.0', 'enabled', 'Mandarin translation label', now()),
  ('macula-greek', 'role', 'syntax', 'Clear-Bible', 'CC BY 4.0', 'enabled', 'Grammatical role annotation', now()),
  ('macula-greek', 'frame', 'syntax', 'Clear-Bible', 'CC BY 4.0', 'enabled', 'Semantic frame annotation', now()),
  ('macula-greek', 'subjref', 'discourse', 'Clear-Bible', 'CC BY 4.0', 'enabled', 'Subject reference annotation', now()),
  ('macula-greek', 'referent', 'discourse', 'Clear-Bible', 'CC BY 4.0', 'enabled', 'Participant referent identifier', now()),
  ('macula-greek', 'domain', 'semantic_domain', 'UBS MARBLE', 'Used with permission', 'disabled_restricted', 'UBS MARBLE semantic domain gated pending separate license verification', now()),
  ('macula-greek', 'ln', 'semantic_domain', 'Louw-Nida', 'Used with permission', 'disabled_restricted', 'Louw-Nida semantic domain gated pending separate license verification', now())
ON CONFLICT (dataset_key, field_name) DO UPDATE SET
  status = EXCLUDED.status,
  decision_note = EXCLUDED.decision_note;

-- 3. Table public.macula_greek_tokens
CREATE TABLE IF NOT EXISTS public.macula_greek_tokens (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  edition_key text NOT NULL CHECK (edition_key IN ('macula-greek-nestle1904', 'macula-greek-sblgnt')),
  xml_id text NOT NULL,
  ref_nt text NOT NULL,
  book smallint NOT NULL CHECK (book BETWEEN 40 AND 66),
  chapter smallint NOT NULL,
  verse_nr smallint NOT NULL,
  word_no smallint NOT NULL,
  role text,
  part_of_speech text,
  word_type text,
  text_form text NOT NULL,
  after_text text,
  lemma text NOT NULL,
  normalized text,
  strongs text,
  morph_code text NOT NULL,
  person text,
  number text,
  gender text,
  case_value text,
  tense text,
  voice text,
  mood text,
  degree text,
  gloss text,
  english text,
  mandarin text,
  frame text,
  subjref text,
  referent text,
  canonical_verse_id integer REFERENCES public.verses(id),
  step_word_id integer REFERENCES public.words(id),
  link_status text NOT NULL DEFAULT 'unmatched' CHECK (link_status IN ('exact_form', 'diacritic_variant', 'variant_reading', 'unmatched', 'quarantined')),
  source_release_id bigint NOT NULL REFERENCES public.source_releases(id),
  source_edition_id bigint NOT NULL REFERENCES public.source_editions(id),
  source_record_id text NOT NULL,
  origin_mode text NOT NULL DEFAULT 'directly_imported' CHECK (origin_mode IN ('directly_imported', 'algorithmically_calculated', 'user_authored')),
  derivation_method text NOT NULL DEFAULT 'macula_greek_tsv',
  CONSTRAINT uq_macula_greek_edition_xmlid UNIQUE (edition_key, xml_id)
);

CREATE INDEX IF NOT EXISTS idx_mgt_ref ON public.macula_greek_tokens(book, chapter, verse_nr, word_no);
CREATE INDEX IF NOT EXISTS idx_mgt_edition_book ON public.macula_greek_tokens(edition_key, book);
CREATE INDEX IF NOT EXISTS idx_mgt_canonical_verse ON public.macula_greek_tokens(canonical_verse_id);
CREATE INDEX IF NOT EXISTS idx_mgt_strongs ON public.macula_greek_tokens(strongs);
CREATE INDEX IF NOT EXISTS idx_mgt_lemma ON public.macula_greek_tokens(lemma);
CREATE INDEX IF NOT EXISTS idx_mgt_step_word ON public.macula_greek_tokens(step_word_id);

ALTER TABLE public.macula_greek_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_select_macula_greek_tokens ON public.macula_greek_tokens;
CREATE POLICY p_select_macula_greek_tokens ON public.macula_greek_tokens
  FOR SELECT TO anon, authenticated
  USING (true);

-- 4. Table public.tagnt_tokens (STEP Amalgamated Greek NT Tokens & Variants)
CREATE TABLE IF NOT EXISTS public.tagnt_tokens (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tagnt_id text NOT NULL,
  word_type text NOT NULL,
  surface_greek text NOT NULL,
  transliteration text NOT NULL,
  english_translation text,
  dstrongs text NOT NULL,
  grammar_code text NOT NULL,
  lemma text NOT NULL,
  step_gloss text,
  editions text NOT NULL,
  meaning_variants text,
  spelling_variants text,
  spanish_translation text,
  sub_meaning text,
  conjoin_word text,
  sstrong_instance text,
  alt_strongs text,
  book smallint NOT NULL CHECK (book BETWEEN 40 AND 66),
  chapter smallint NOT NULL,
  verse_nr smallint NOT NULL,
  word_position smallint NOT NULL,
  canonical_verse_id integer REFERENCES public.verses(id),
  step_word_id integer REFERENCES public.words(id),
  link_status text NOT NULL DEFAULT 'exact_match' CHECK (link_status IN ('exact_match', 'variant_reading', 'spelling_variant', 'traditional_addition', 'critical_omission', 'unmatched')),
  source_release_id bigint NOT NULL REFERENCES public.source_releases(id),
  source_edition_id bigint NOT NULL REFERENCES public.source_editions(id),
  source_record_id text NOT NULL,
  origin_mode text NOT NULL DEFAULT 'directly_imported' CHECK (origin_mode IN ('directly_imported', 'algorithmically_calculated', 'user_authored')),
  derivation_method text NOT NULL DEFAULT 'stepbible_tagnt_txt',
  CONSTRAINT uq_tagnt_token_id UNIQUE (source_release_id, tagnt_id)
);

CREATE INDEX IF NOT EXISTS idx_tagnt_verse_pos ON public.tagnt_tokens(book, chapter, verse_nr, word_position);
CREATE INDEX IF NOT EXISTS idx_tagnt_canonical_verse ON public.tagnt_tokens(canonical_verse_id);
CREATE INDEX IF NOT EXISTS idx_tagnt_dstrongs ON public.tagnt_tokens(dstrongs);
CREATE INDEX IF NOT EXISTS idx_tagnt_word_type ON public.tagnt_tokens(word_type);
CREATE INDEX IF NOT EXISTS idx_tagnt_editions ON public.tagnt_tokens USING gin (to_tsvector('simple', editions));

ALTER TABLE public.tagnt_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS p_select_tagnt_tokens ON public.tagnt_tokens;
CREATE POLICY p_select_tagnt_tokens ON public.tagnt_tokens
  FOR SELECT TO anon, authenticated
  USING (true);

-- 5. Batch Ingestion RPC for MACULA Greek Tokens
CREATE OR REPLACE FUNCTION public.ingest_macula_greek_batch_v1(
  p_tokens jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted integer := 0;
BEGIN
  WITH ins AS (
    INSERT INTO public.macula_greek_tokens (
      edition_key, xml_id, ref_nt, book, chapter, verse_nr, word_no,
      role, part_of_speech, word_type, text_form, after_text, lemma, normalized,
      strongs, morph_code, person, number, gender, case_value, tense, voice, mood, degree,
      gloss, english, mandarin, frame, subjref, referent,
      canonical_verse_id, step_word_id, link_status,
      source_release_id, source_edition_id, source_record_id
    )
    SELECT
      t->>'edition_key',
      t->>'xml_id',
      t->>'ref_nt',
      (t->>'book')::smallint,
      (t->>'chapter')::smallint,
      (t->>'verse_nr')::smallint,
      (t->>'word_no')::smallint,
      t->>'role',
      t->>'part_of_speech',
      t->>'word_type',
      t->>'text_form',
      t->>'after_text',
      t->>'lemma',
      t->>'normalized',
      t->>'strongs',
      t->>'morph_code',
      t->>'person',
      t->>'number',
      t->>'gender',
      t->>'case_value',
      t->>'tense',
      t->>'voice',
      t->>'mood',
      t->>'degree',
      t->>'gloss',
      t->>'english',
      t->>'mandarin',
      t->>'frame',
      t->>'subjref',
      t->>'referent',
      (t->>'canonical_verse_id')::integer,
      (t->>'step_word_id')::integer,
      COALESCE(t->>'link_status', 'unmatched'),
      (t->>'source_release_id')::bigint,
      (t->>'source_edition_id')::bigint,
      t->>'source_record_id'
    FROM jsonb_array_elements(p_tokens) AS t
    ON CONFLICT (edition_key, xml_id) DO UPDATE SET
      text_form = EXCLUDED.text_form,
      after_text = EXCLUDED.after_text,
      lemma = EXCLUDED.lemma,
      normalized = EXCLUDED.normalized,
      strongs = EXCLUDED.strongs,
      morph_code = EXCLUDED.morph_code,
      gloss = EXCLUDED.gloss,
      english = EXCLUDED.english,
      canonical_verse_id = EXCLUDED.canonical_verse_id,
      step_word_id = EXCLUDED.step_word_id,
      link_status = EXCLUDED.link_status
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM ins;

  RETURN jsonb_build_object(
    'success', true,
    'inserted_or_updated', v_inserted
  );
END;
$$;

-- 6. Batch Ingestion RPC for TAGNT Tokens
CREATE OR REPLACE FUNCTION public.ingest_tagnt_batch_v1(
  p_tokens jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted integer := 0;
BEGIN
  WITH ins AS (
    INSERT INTO public.tagnt_tokens (
      tagnt_id, word_type, surface_greek, transliteration, english_translation,
      dstrongs, grammar_code, lemma, step_gloss, editions,
      meaning_variants, spelling_variants, spanish_translation, sub_meaning,
      conjoin_word, sstrong_instance, alt_strongs,
      book, chapter, verse_nr, word_position,
      canonical_verse_id, step_word_id, link_status,
      source_release_id, source_edition_id, source_record_id
    )
    SELECT
      t->>'tagnt_id',
      t->>'word_type',
      t->>'surface_greek',
      t->>'transliteration',
      t->>'english_translation',
      t->>'dstrongs',
      t->>'grammar_code',
      t->>'lemma',
      t->>'step_gloss',
      t->>'editions',
      t->>'meaning_variants',
      t->>'spelling_variants',
      t->>'spanish_translation',
      t->>'sub_meaning',
      t->>'conjoin_word',
      t->>'sstrong_instance',
      t->>'alt_strongs',
      (t->>'book')::smallint,
      (t->>'chapter')::smallint,
      (t->>'verse_nr')::smallint,
      (t->>'word_position')::smallint,
      (t->>'canonical_verse_id')::integer,
      (t->>'step_word_id')::integer,
      COALESCE(t->>'link_status', 'exact_match'),
      (t->>'source_release_id')::bigint,
      (t->>'source_edition_id')::bigint,
      t->>'source_record_id'
    FROM jsonb_array_elements(p_tokens) AS t
    ON CONFLICT (source_release_id, tagnt_id) DO UPDATE SET
      surface_greek = EXCLUDED.surface_greek,
      transliteration = EXCLUDED.transliteration,
      english_translation = EXCLUDED.english_translation,
      dstrongs = EXCLUDED.dstrongs,
      grammar_code = EXCLUDED.grammar_code,
      lemma = EXCLUDED.lemma,
      step_gloss = EXCLUDED.step_gloss,
      editions = EXCLUDED.editions,
      meaning_variants = EXCLUDED.meaning_variants,
      spelling_variants = EXCLUDED.spelling_variants,
      canonical_verse_id = EXCLUDED.canonical_verse_id,
      step_word_id = EXCLUDED.step_word_id,
      link_status = EXCLUDED.link_status
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM ins;

  RETURN jsonb_build_object(
    'success', true,
    'inserted_or_updated', v_inserted
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.ingest_macula_greek_batch_v1(jsonb) TO anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.ingest_tagnt_batch_v1(jsonb) TO anon, authenticated, service_role, postgres;
NOTIFY pgrst, 'reload schema';
