-- ============================================================================
-- Migration: 20261109101000_audit_greek_tagnt_and_macula_alignment.sql
-- Description: Correct 21,363 shifted TAGNT tokens caused by Traditional additions ('k'),
--              and align Macula Greek tokens with exact/spelling variants vs unmatched additions.
-- ============================================================================

-- 1. Align NA28 TAGNT tokens to canonical verse word_ids
WITH ranked_tagnt AS (
  SELECT 
    tt.id,
    v.word_ids[row_number() OVER (PARTITION BY tt.canonical_verse_id ORDER BY tt.id)] AS resolved_word_id
  FROM public.tagnt_tokens tt
  JOIN public.verses v ON v.id = tt.canonical_verse_id
  WHERE tt.editions ~ '(^|[,;+[:space:]])NA28([,;+[:space:]]|$)'
)
UPDATE public.tagnt_tokens tt
SET
  step_word_id = rt.resolved_word_id,
  link_status = 'exact_match'
FROM ranked_tagnt rt
WHERE tt.id = rt.id
  AND (tt.step_word_id IS DISTINCT FROM rt.resolved_word_id
       OR tt.link_status <> 'exact_match');

-- 2. Explicitly unlink non-NA28 TAGNT tokens (traditional additions / TR variants)
UPDATE public.tagnt_tokens tt
SET
  step_word_id = NULL,
  link_status = 'traditional_addition'
WHERE NOT (tt.editions ~ '(^|[,;+[:space:]])NA28([,;+[:space:]]|$)')
  AND (tt.step_word_id IS NOT NULL OR tt.link_status <> 'traditional_addition');

-- 3. Align macula_greek_tokens with canonical verse words
WITH candidate_greek AS (
  SELECT 
    mgt.id,
    COALESCE(
      -- Priority 1: exact unaccented match closest to word_no
      (
        SELECT u.wid
        FROM public.verses v
        CROSS JOIN LATERAL unnest(v.word_ids) WITH ORDINALITY AS u(wid, ord)
        JOIN public.words w ON w.id = u.wid
        WHERE v.id = mgt.canonical_verse_id
          AND mgt.text_form IS NOT NULL
          AND lower(regexp_replace(regexp_replace(normalize(mgt.text_form, NFD), '[\u0300-\u036f]', '', 'g'), '[^a-zα-ω]', '', 'gi')) =
              lower(regexp_replace(regexp_replace(normalize(w.original_word, NFD), '[\u0300-\u036f]', '', 'g'), '[^a-zα-ω]', '', 'gi'))
        ORDER BY abs(u.ord - mgt.word_no)
        LIMIT 1
      ),
      -- Priority 2: Strong's number match closest to word_no
      (
        SELECT u.wid
        FROM public.verses v
        CROSS JOIN LATERAL unnest(v.word_ids) WITH ORDINALITY AS u(wid, ord)
        JOIN public.words w ON w.id = u.wid
        WHERE v.id = mgt.canonical_verse_id
          AND mgt.strongs IS NOT NULL AND mgt.strongs <> ''
          AND w.strongs_nr = 'G' || mgt.strongs
        ORDER BY abs(u.ord - mgt.word_no)
        LIMIT 1
      )
    ) AS resolved_word_id
  FROM public.macula_greek_tokens mgt
  WHERE mgt.canonical_verse_id IS NOT NULL
)
UPDATE public.macula_greek_tokens mgt
SET
  step_word_id = cg.resolved_word_id,
  link_status = CASE
    WHEN cg.resolved_word_id IS NULL THEN 'unmatched'
    ELSE 'exact_form'
  END
FROM candidate_greek cg
WHERE mgt.id = cg.id
  AND (mgt.step_word_id IS DISTINCT FROM cg.resolved_word_id
       OR mgt.link_status IS DISTINCT FROM (
         CASE
           WHEN cg.resolved_word_id IS NULL THEN 'unmatched'
           ELSE 'exact_form'
         END
       ));
