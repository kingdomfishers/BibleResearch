-- Migration: 20261109090000_audit_ot_versification_and_nehemiah_lxx.sql
-- Description: AUDIT-02: Fix OT MT-to-Canonical versification shift across macula_hebrew_morphemes,
--              morphhb_tokens, cross_token_mappings, and syntax_nodes, and ingest 406 Nehemiah verses
--              into hebrew_lxx_verse_map from Swete 18.Esdras_B chapters 11-23.

BEGIN;

-- 1. Ingest Nehemiah (book 16) into hebrew_lxx_verse_map
-- Canonical Nehemiah (406 verses, book 16) maps to Swete 18.Esdras_B chapters 11..23 (lxx_chapter = v.chapter + 10)
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
  v.id AS canonical_verse_id,
  18::smallint AS lxx_book_no,
  (v.chapter + 10)::smallint AS lxx_chapter,
  ''::text AS lxx_chapter_suffix,
  v.verse_nr::smallint AS lxx_verse_nr,
  ''::text AS lxx_verse_suffix,
  'versification_shift'::text AS mapping_kind,
  ('Nehemiah canonical book 16 ch ' || v.chapter || ' aligns to Swete 18.Esdras_B ch ' || (v.chapter + 10) || '.')::text AS rule_citation,
  'algorithmically_calculated'::text AS origin_mode,
  'mt_lxx_versification_alignment'::text AS derivation_method,
  '1.1.0'::text AS algorithm_version,
  9::bigint AS source_release_id,
  ('MT-LXX:16.' || v.chapter || '.' || v.verse_nr || '->18.' || (v.chapter + 10) || '.' || v.verse_nr)::text AS source_record_id
FROM public.verses v
WHERE v.book = 16
ON CONFLICT (canonical_verse_id, lxx_book_no, lxx_chapter, lxx_chapter_suffix, lxx_verse_nr, lxx_verse_suffix) DO NOTHING;

-- 2. Align macula_hebrew_morphemes for shifted OT verses
WITH shifted AS (
  SELECT
    m.id AS morpheme_id,
    vm.canonical_verse_id AS new_verse_id,
    COALESCE(
      CASE 
        WHEN m.word_no <= cardinality(v.word_ids) AND (
          m.text_form IS NULL OR regexp_replace(m.text_form, '[^\u05D0-\u05EA]', '', 'g') = '' OR
          translate(regexp_replace(w.original_word, '[^\u05D0-\u05EA]', '', 'g'), 'ךםןףץ', 'כמנפצ')
          LIKE '%' || translate(regexp_replace(m.text_form, '[^\u05D0-\u05EA]', '', 'g'), 'ךםןףץ', 'כמנפצ') || '%'
        ) THEN v.word_ids[m.word_no]
        ELSE NULL
      END,
      (
        SELECT w_sub.id
        FROM unnest(v.word_ids) WITH ORDINALITY AS u(wid, ord)
        JOIN public.words w_sub ON w_sub.id = u.wid
        WHERE m.text_form IS NOT NULL 
          AND regexp_replace(m.text_form, '[^\u05D0-\u05EA]', '', 'g') <> ''
          AND translate(regexp_replace(w_sub.original_word, '[^\u05D0-\u05EA]', '', 'g'), 'ךםןףץ', 'כמנפצ')
              LIKE '%' || translate(regexp_replace(m.text_form, '[^\u05D0-\u05EA]', '', 'g'), 'ךםןףץ', 'כמנפצ') || '%'
        ORDER BY abs(u.ord - m.word_no)
        LIMIT 1
      )
    ) AS resolved_word_id
  FROM public.macula_hebrew_morphemes m
  JOIN public.versification_mappings vm
    ON vm.to_edition_id = 5
   AND vm.to_book = m.book
   AND vm.to_chapter = m.chapter_mt
   AND vm.to_verse_nr = m.verse_mt
  JOIN public.verses v ON v.id = vm.canonical_verse_id
  LEFT JOIN public.words w ON w.id = v.word_ids[m.word_no]
)
UPDATE public.macula_hebrew_morphemes m
SET
  canonical_verse_id = s.new_verse_id,
  word_id = s.resolved_word_id,
  link_status = CASE
    WHEN s.resolved_word_id IS NOT NULL THEN 'matched_consonantal'
    ELSE 'unmatched'
  END
FROM shifted s
WHERE m.id = s.morpheme_id;

-- 2b. Re-align any residual mismatched macula_hebrew_morphemes across non-shifted verses
WITH mismatches AS (
  SELECT m.id, m.word_no, m.text_form, v.id as v_id, v.word_ids
  FROM public.macula_hebrew_morphemes m
  JOIN public.verses v ON v.id = m.canonical_verse_id
  LEFT JOIN public.words w ON w.id = m.word_id
  WHERE m.link_status = 'matched_consonantal'
    AND m.text_form IS NOT NULL 
    AND regexp_replace(m.text_form, '[^\u05D0-\u05EA]', '', 'g') <> ''
    AND (w.id IS NULL OR translate(regexp_replace(w.original_word, '[^\u05D0-\u05EA]', '', 'g'), 'ךםןףץ', 'כמנפצ') 
        NOT LIKE '%' || translate(regexp_replace(m.text_form, '[^\u05D0-\u05EA]', '', 'g'), 'ךםןףץ', 'כמנפצ') || '%')
),
resolved AS (
  SELECT 
    m.id,
    w_new.wid AS new_word_id
  FROM mismatches m
  LEFT JOIN LATERAL (
    SELECT u.wid
    FROM unnest(m.word_ids) WITH ORDINALITY AS u(wid, ord)
    JOIN public.words w_sub ON w_sub.id = u.wid
    WHERE translate(regexp_replace(w_sub.original_word, '[^\u05D0-\u05EA]', '', 'g'), 'ךםןףץ', 'כמנפצ')
          LIKE '%' || translate(regexp_replace(m.text_form, '[^\u05D0-\u05EA]', '', 'g'), 'ךםןףץ', 'כמנפצ') || '%'
    ORDER BY abs(u.ord - m.word_no)
    LIMIT 1
  ) w_new ON true
)
UPDATE public.macula_hebrew_morphemes m
SET
  word_id = r.new_word_id,
  link_status = CASE WHEN r.new_word_id IS NOT NULL THEN 'matched_consonantal' ELSE 'unmatched' END
FROM resolved r
WHERE m.id = r.id;

-- 3. Align morphhb_tokens for shifted OT verses
WITH shifted_morph AS (
  SELECT
    mt.id AS token_id,
    vm.canonical_verse_id AS new_verse_id,
    COALESCE(
      CASE 
        WHEN mt.word_num <= cardinality(v.word_ids) AND (
          mt.word_text IS NULL OR regexp_replace(mt.word_text, '[^\u05D0-\u05EA]', '', 'g') = '' OR
          translate(regexp_replace(w.original_word, '[^\u05D0-\u05EA]', '', 'g'), 'ךםןףץ', 'כמנפצ')
          LIKE '%' || translate(regexp_replace(mt.word_text, '[^\u05D0-\u05EA]', '', 'g'), 'ךםןףץ', 'כמנפצ') || '%'
        ) THEN v.word_ids[mt.word_num]
        ELSE NULL
      END,
      (
        SELECT w_sub.id
        FROM unnest(v.word_ids) WITH ORDINALITY AS u(wid, ord)
        JOIN public.words w_sub ON w_sub.id = u.wid
        WHERE mt.word_text IS NOT NULL 
          AND regexp_replace(mt.word_text, '[^\u05D0-\u05EA]', '', 'g') <> ''
          AND translate(regexp_replace(w_sub.original_word, '[^\u05D0-\u05EA]', '', 'g'), 'ךםןףץ', 'כמנפצ')
              LIKE '%' || translate(regexp_replace(mt.word_text, '[^\u05D0-\u05EA]', '', 'g'), 'ךםןףץ', 'כמנפצ') || '%'
        ORDER BY abs(u.ord - mt.word_num)
        LIMIT 1
      )
    ) AS resolved_word_id,
    mt.word_text,
    mt.is_qere,
    mt.is_ketiv
  FROM public.morphhb_tokens mt
  JOIN public.versification_mappings vm
    ON vm.to_edition_id = 5
   AND vm.to_book = mt.book
   AND vm.to_chapter = mt.chapter
   AND vm.to_verse_nr = mt.verse_nr
  JOIN public.verses v ON v.id = vm.canonical_verse_id
  LEFT JOIN public.words w ON w.id = v.word_ids[mt.word_num]
)
UPDATE public.morphhb_tokens mt
SET
  canonical_verse_id = sm.new_verse_id,
  step_word_id = sm.resolved_word_id,
  link_status = CASE
    WHEN sm.resolved_word_id IS NULL THEN 'unlinked'
    WHEN sm.is_qere THEN 'qere_form'
    WHEN sm.is_ketiv THEN 'ketiv_variant'
    ELSE 'exact_form'
  END
FROM shifted_morph sm
WHERE mt.id = sm.token_id;

-- 4. Align cross_token_mappings
UPDATE public.cross_token_mappings ctm
SET
  canonical_verse_id = m.canonical_verse_id,
  step_word_id = m.word_id
FROM public.macula_hebrew_morphemes m
WHERE ctm.macula_morpheme_id = m.id
  AND (ctm.canonical_verse_id IS DISTINCT FROM m.canonical_verse_id OR ctm.step_word_id IS DISTINCT FROM m.word_id);

-- 5. Align syntax_nodes pilot terminals in PostgreSQL
UPDATE public.syntax_nodes sn
SET
  verse_id = m.canonical_verse_id,
  end_verse_id = m.canonical_verse_id,
  terminal_word_id = m.word_id
FROM public.macula_hebrew_morphemes m
WHERE sn.edition_id = 11
  AND sn.is_terminal = true
  AND sn.terminal_xml_id = m.macula_id
  AND (sn.verse_id IS DISTINCT FROM m.canonical_verse_id OR sn.terminal_word_id IS DISTINCT FROM m.word_id);

-- 5b. Update parent syntax_nodes spans
WITH RECURSIVE spans AS (
  SELECT 
    tree_id,
    min(verse_id) as min_verse,
    max(end_verse_id) as max_verse
  FROM public.syntax_nodes
  WHERE edition_id = 11 AND is_terminal = true AND verse_id IS NOT NULL
  GROUP BY tree_id
)
UPDATE public.syntax_nodes sn
SET
  verse_id = s.min_verse,
  end_verse_id = s.max_verse
FROM spans s
WHERE sn.edition_id = 11
  AND sn.tree_id = s.tree_id
  AND (sn.verse_id IS DISTINCT FROM s.min_verse OR sn.end_verse_id IS DISTINCT FROM s.max_verse);

COMMIT;
