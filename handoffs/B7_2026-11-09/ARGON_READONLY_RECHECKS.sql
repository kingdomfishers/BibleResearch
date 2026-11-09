-- HISTORICAL ARGON SNAPSHOT: expected values and anonymous RPC policy have changed. Run ARGON_UPDATED_READONLY_RECHECKS.sql instead.
-- Current Greek mismatch count is 0 after guarded production migration; anonymous note-writing access is intentionally ON by user's explicit request.
-- Argon interruption — READ-ONLY reproducible live integrity checks.
-- Target Supabase project ejoperxiwxlcbsqrkrvb. No mutation.
-- 1. Greek syntax vs source-token identities (expected 956 mismatches as observed on 2026-11-09).
WITH v AS (
 SELECT sn.id, sn.terminal_word_id syntax_word_id, gt.step_word_id source_word_id,
        sn.verse_id,gt.canonical_verse_id
 FROM public.syntax_nodes sn
 JOIN public.source_editions se ON sn.edition_id=se.id
 JOIN public.macula_greek_tokens gt ON gt.source_edition_id=sn.edition_id AND gt.xml_id=sn.terminal_xml_id
 WHERE se.edition_key LIKE 'macula-greek%' AND sn.is_terminal
)
SELECT count(*) terminals,
       count(*) FILTER(WHERE syntax_word_id IS DISTINCT FROM source_word_id) mismatches,
       count(*) FILTER(WHERE syntax_word_id IS NULL AND source_word_id IS NOT NULL) syntax_null_only,
       count(*) FILTER(WHERE syntax_word_id IS NOT NULL AND source_word_id IS NULL) source_null_only,
       count(*) FILTER(WHERE syntax_word_id IS NOT NULL AND source_word_id IS NOT NULL AND syntax_word_id <> source_word_id) different_nonnull_ids,
       count(*) FILTER(WHERE verse_id IS DISTINCT FROM canonical_verse_id) verse_disagreement FROM v;

-- 2. Inconsistent Hebrew sibling word linkage (not independently proof of exact correction).
WITH groups AS (
 SELECT book,chapter_mt,verse_mt,word_no,count(*) morphs,count(distinct word_id) FILTER(WHERE word_id IS NOT NULL) targets
 FROM public.macula_hebrew_morphemes GROUP BY 1,2,3,4
)
SELECT count(*) FILTER(WHERE targets>1) inconsistent_groups,
       coalesce(sum(morphs) FILTER(WHERE targets>1),0) affected_morphs
FROM groups;

-- 3. Confirm note-writing RPCs remain restricted.
SELECT p.proname,
       has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,
       has_function_privilege('service_role',p.oid,'EXECUTE') service_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('save_note_v1','delete_note_v1','set_note_review_v1')
ORDER BY p.proname;

-- 4. Count published test notes without reading their content or modifying user data.
SELECT count(*) total,
       count(*) FILTER(WHERE status='published') published,
       count(*) FILTER(WHERE status='published' AND
                        (title ILIKE '%[TEST]%' OR body_md ILIKE '%[TEST]%')) published_test
FROM public.notes;

-- 5. Old-corpus B7 canary (must become PASS after verified corpus rebuild).
SELECT bible_internal.verify_b7_deployed_canaries_v1() AS result;
