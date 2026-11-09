-- READ-ONLY live rechecks (2026-11-09). Never run a production TRUNCATE here.
-- 1. Greek syntax identity; after migration expect 0 mismatches across 14,926 paired Greek terminals.
WITH g AS (
 SELECT sn.terminal_word_id syntax_id,gt.step_word_id token_id,sn.verse_id syntax_verse,gt.canonical_verse_id token_verse
 FROM public.syntax_nodes sn JOIN public.source_editions e ON e.id=sn.edition_id
 JOIN public.macula_greek_tokens gt ON gt.source_edition_id=sn.edition_id AND gt.xml_id=sn.terminal_xml_id
 WHERE e.edition_key LIKE 'macula-greek%' AND sn.is_terminal
) SELECT count(*) paired,count(*) FILTER(WHERE syntax_id IS DISTINCT FROM token_id) mismatched_word,
 count(*) FILTER(WHERE syntax_verse IS DISTINCT FROM token_verse) mismatched_verse FROM g;
-- 2. Private backup; expect 956 saved, 892 exact-form, 64 unmatched.
SELECT count(*) saved,
 count(*) FILTER(WHERE source_link_status='exact_form' AND corrected_word_id IS NOT NULL) exact_form,
 count(*) FILTER(WHERE source_link_status='unmatched' AND corrected_word_id IS NULL) now_unlinked
FROM bible_internal.b7_greek_terminal_repair_20261109;
-- 3. Hebrew sibling conflicts; previous 1,917 groups / 4,391 morphemes.
WITH g AS(
 SELECT book,chapter_mt,verse_mt,word_no,count(*) rows,count(distinct word_id) FILTER(WHERE word_id IS NOT NULL) ids
 FROM public.macula_hebrew_morphemes GROUP BY 1,2,3,4
) SELECT count(*) FILTER(WHERE ids>1) conflicting_groups,coalesce(sum(rows) FILTER(WHERE ids>1),0) affected_rows FROM g;
-- 4. Explicit MT mapping consistency. Does NOT prove split-title correspondence.
WITH source AS(
 SELECT DISTINCT m.book,m.chapter_mt,m.verse_mt,m.canonical_verse_id,
 'MT:'||b.usfm||'.'||m.chapter_mt||'.'||m.verse_mt ref FROM public.macula_hebrew_morphemes m
 JOIN public.books b ON b.id=m.book
) SELECT count(*) FILTER(WHERE vm.canonical_verse_id IS NOT NULL) explicit_count,
 count(*) FILTER(WHERE vm.canonical_verse_id IS NOT NULL AND source.canonical_verse_id<>vm.canonical_verse_id) registered_mismatch
FROM source LEFT JOIN public.versification_mappings vm ON vm.to_ref=source.ref AND vm.from_edition_id=1;
-- 5. LXX targets absent from stored source. Previously 45, Nehemiah 31.
SELECT count(*) FILTER(WHERE NOT EXISTS(
 SELECT 1 FROM public.lxx_swete_words w WHERE w.book_no=hm.lxx_book_no AND w.chapter=hm.lxx_chapter
 AND w.verse_nr=hm.lxx_verse_nr AND coalesce(w.chapter_suffix,'')=coalesce(hm.lxx_chapter_suffix,'')
 AND coalesce(w.verse_suffix,'')=coalesce(hm.lxx_verse_suffix,''))) missing
FROM public.hebrew_lxx_verse_map hm WHERE hm.lxx_book_no IS NOT NULL;
-- 6. User intentionally permits anonymous note edits; expect true for three functions.
SELECT p.proname,has_function_privilege('anon',p.oid,'EXECUTE') anon
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('save_note_v1','delete_note_v1','set_note_review_v1');
-- 7. B7 Cloudflare deployed canaries; currently FAIL until verified static rebuild.
SELECT bible_internal.verify_b7_deployed_canaries_v1();
-- 8. Stage G protections: expect 23 triggers.
SELECT count(*) protected FROM pg_trigger WHERE tgname='stage_g_release_gate' AND NOT tgisinternal;
