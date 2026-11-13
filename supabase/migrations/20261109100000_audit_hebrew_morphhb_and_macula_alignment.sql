-- ============================================================================
-- Migration: 20261109100000_audit_hebrew_morphhb_and_macula_alignment.sql
-- Description: Correct 542 mismatched MorphHB tokens, 1,987 unmapped Macula morphemes,
--              and synchronize cross_token_mappings and syntax_nodes.
-- ============================================================================

-- 1. Correct morphhb_tokens with consonantal alignment within canonical verse
WITH candidate_morph AS (
  SELECT 
    mt.id,
    COALESCE(
      CASE 
        WHEN mt.word_num <= cardinality(v.word_ids) AND (
          mt.word_text IS NULL OR regexp_replace(mt.word_text, '[^\u05D0-\u05EA]', '', 'g') = '' OR
          translate(regexp_replace(w_curr.original_word, '[^\u05D0-\u05EA]', '', 'g'), 'ךםןףץ', 'כמנפצ')
          LIKE '%' || translate(regexp_replace(mt.word_text, '[^\u05D0-\u05EA]', '', 'g'), 'ךםןףץ', 'כמנפצ') || '%'
        ) THEN v.word_ids[mt.word_num]
        ELSE NULL
      END,
      (
        SELECT u.wid
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
    mt.is_qere,
    mt.is_ketiv
  FROM public.morphhb_tokens mt
  JOIN public.verses v ON v.id = mt.canonical_verse_id
  LEFT JOIN public.words w_curr ON w_curr.id = v.word_ids[mt.word_num]
  WHERE mt.canonical_verse_id IS NOT NULL
)
UPDATE public.morphhb_tokens mt
SET
  step_word_id = cm.resolved_word_id,
  link_status = CASE
    WHEN cm.resolved_word_id IS NULL THEN 'unlinked'
    WHEN cm.is_qere THEN 'qere_form'
    WHEN cm.is_ketiv THEN 'ketiv_variant'
    ELSE 'exact_form'
  END
FROM candidate_morph cm
WHERE mt.id = cm.id
  AND (mt.step_word_id IS DISTINCT FROM cm.resolved_word_id
       OR mt.link_status IS DISTINCT FROM (
         CASE
           WHEN cm.resolved_word_id IS NULL THEN 'unlinked'
           WHEN cm.is_qere THEN 'qere_form'
           WHEN cm.is_ketiv THEN 'ketiv_variant'
           ELSE 'exact_form'
         END
       ));

-- 2. Link 1,987 unmapped macula_hebrew_morphemes where word_no > cardinality(v.word_ids)
WITH candidate_macula AS (
  SELECT 
    m.id,
    (
      SELECT u.wid
      FROM public.verses v
      CROSS JOIN LATERAL unnest(v.word_ids) WITH ORDINALITY AS u(wid, ord)
      JOIN public.words w ON w.id = u.wid
      WHERE v.id = m.canonical_verse_id
        AND m.text_form IS NOT NULL
        AND regexp_replace(m.text_form, '[^\u05D0-\u05EA]', '', 'g') <> ''
        AND translate(regexp_replace(w.original_word, '[^\u05D0-\u05EA]', '', 'g'), 'ךםןףץ', 'כמנפצ')
            LIKE '%' || translate(regexp_replace(m.text_form, '[^\u05D0-\u05EA]', '', 'g'), 'ךםןףץ', 'כמנפצ') || '%'
      ORDER BY abs(u.ord - m.word_no)
      LIMIT 1
    ) AS resolved_word_id
  FROM public.macula_hebrew_morphemes m
  WHERE m.link_status = 'unmatched'
    AND m.canonical_verse_id IS NOT NULL
)
UPDATE public.macula_hebrew_morphemes m
SET
  word_id = cm.resolved_word_id,
  link_status = 'matched_consonantal'
FROM candidate_macula cm
WHERE m.id = cm.id
  AND cm.resolved_word_id IS NOT NULL;

-- 3. Synchronize cross_token_mappings
UPDATE public.cross_token_mappings ctm
SET
  canonical_verse_id = m.canonical_verse_id,
  step_word_id = m.word_id
FROM public.macula_hebrew_morphemes m
WHERE ctm.macula_morpheme_id = m.id
  AND (ctm.canonical_verse_id IS DISTINCT FROM m.canonical_verse_id
       OR ctm.step_word_id IS DISTINCT FROM m.word_id);

-- 4. Synchronize syntax_nodes
UPDATE public.syntax_nodes sn
SET
  verse_id = m.canonical_verse_id,
  terminal_word_id = m.word_id,
  terminal_mapping_status = CASE
    WHEN m.word_id IS NOT NULL THEN 'exact_xml_id'
    ELSE 'source_reference_only'
  END
FROM public.macula_hebrew_morphemes m
WHERE sn.terminal_xml_id = m.macula_id
  AND (sn.verse_id IS DISTINCT FROM m.canonical_verse_id
       OR sn.terminal_word_id IS DISTINCT FROM m.word_id
       OR sn.terminal_mapping_status IS DISTINCT FROM (
         CASE
           WHEN m.word_id IS NOT NULL THEN 'exact_xml_id'
           ELSE 'source_reference_only'
         END
       ));
