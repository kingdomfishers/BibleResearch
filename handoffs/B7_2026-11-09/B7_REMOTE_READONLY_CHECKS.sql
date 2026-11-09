-- Live read-only checks. Run via authenticated Supabase SQL console or service role.
-- The canary gate must fail while Cloudflare is stale.
SELECT bible_internal.verify_b7_deployed_canaries_v1() AS b7_canary;

-- Structural MT crosswalk uniqueness (not independent textual equivalence proof).
SELECT count(*) AS explicit_mt_mappings,
       count(DISTINCT to_ref) AS unique_mt_source_refs
FROM public.versification_mappings
WHERE from_edition_id=1 AND to_edition_id=5;

-- Canonical word membership for all Hebrew/MorphHB source rows.
SELECT 'macula_hebrew' AS source, count(*) AS rows,
       count(*) FILTER (WHERE word_id IS NOT NULL AND NOT word_id = ANY(v.word_ids)) AS wrong_verse_membership
FROM public.macula_hebrew_morphemes m JOIN public.verses v ON v.id=m.canonical_verse_id
UNION ALL
SELECT 'morphhb',count(*),
       count(*) FILTER (WHERE step_word_id IS NOT NULL AND NOT step_word_id = ANY(v.word_ids))
FROM public.morphhb_tokens m JOIN public.verses v ON v.id=m.canonical_verse_id;

-- Number of LXX mapping rows which point to absent Swete source verses.
SELECT count(*) AS total_lxx_mappings,
       count(*) FILTER (WHERE hm.lxx_book_no IS NULL) AS no_lxx_book,
       count(*) FILTER (WHERE hm.lxx_book_no IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM public.lxx_swete_words w
           WHERE w.book_no=hm.lxx_book_no AND w.chapter=hm.lxx_chapter
             AND w.verse_nr=hm.lxx_verse_nr
             AND COALESCE(w.chapter_suffix,'')=COALESCE(hm.lxx_chapter_suffix,'')
             AND COALESCE(w.verse_suffix,'')=COALESCE(hm.lxx_verse_suffix,''))) AS absent_lxx_text
FROM public.hebrew_lxx_verse_map hm;