-- Migration: 20261106190000_security_hardening.sql
-- Description: Phase 1 Critical Security Hardening
-- 1. Enable RLS on 5 legacy tables (content, posts, pages, needs, offers)
-- 2. Revoke execute on all ingestion/administrative/mutation functions from anon and authenticated
-- 3. Switch read-only research functions from SECURITY DEFINER to SECURITY INVOKER
-- 4. Fix search_path on functions with mutable role search paths

-- 1. ENABLE RLS ON LEGACY TABLES
ALTER TABLE IF EXISTS public.content ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.needs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.posts ENABLE ROW LEVEL SECURITY;

-- 2. REVOKE EXECUTE ON ADMINISTRATIVE & INGESTION FUNCTIONS
REVOKE EXECUTE ON FUNCTION public.clean_stale_hebrew_lxx_jeremiah_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clean_stale_hebrew_lxx_jeremiah_v1() TO service_role;

REVOKE EXECUTE ON FUNCTION public.create_children_items(bigint, text, bigint[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_children_items(bigint, text, bigint[]) TO service_role;

REVOKE EXECUTE ON FUNCTION public.new_message(bigint, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.new_message(bigint, bigint, text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.ingest_cross_token_mappings_batch_v1(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_cross_token_mappings_batch_v1(jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.ingest_hebrew_lxx_mappings_batch_v1(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_hebrew_lxx_mappings_batch_v1(jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.ingest_hebrew_lxx_word_alignments_batch_v1(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_hebrew_lxx_word_alignments_batch_v1(jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.ingest_macula_batch_v1(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_macula_batch_v1(jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.ingest_macula_greek_batch_v1(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_macula_greek_batch_v1(jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.ingest_morphhb_batch_v1(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_morphhb_batch_v1(jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.ingest_swete_words_batch_v1(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_swete_words_batch_v1(jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.ingest_syntax_tree_batch_v1(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_syntax_tree_batch_v1(jsonb, jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.ingest_tagnt_batch_v1(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_tagnt_batch_v1(jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.ingest_lexemes_batch_v1(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_lexemes_batch_v1(jsonb) TO service_role;

-- 3. HARDEN CLEANUP FUNCTION WITH EXPLICIT ROLE CHECK
CREATE OR REPLACE FUNCTION public.clean_stale_hebrew_lxx_jeremiah_v1()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF auth.role() = 'anon' OR auth.role() = 'authenticated' THEN
    RAISE EXCEPTION 'Access denied: administrative functions cannot be invoked by unprivileged callers';
  END IF;

  DELETE FROM public.hebrew_lxx_verse_map 
  WHERE id IN (
    SELECT m.id 
    FROM public.hebrew_lxx_verse_map m 
    JOIN public.verses v ON v.id = m.canonical_verse_id 
    WHERE v.book = 24 AND m.derivation_method = 'mt_lxx_versification_alignment'
  );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

-- 4. SWITCH READ-ONLY RESEARCH & VALIDATION FUNCTIONS TO SECURITY INVOKER
ALTER FUNCTION public.audit_evidence_coverage_v1() SECURITY INVOKER;
ALTER FUNCTION public.get_hebrew_import_status_v1() SECURITY INVOKER;
ALTER FUNCTION public.lookup_septuagint_by_canonical_verse_v1(integer) SECURITY INVOKER;
ALTER FUNCTION public.lookup_septuagint_passage_v1(smallint, smallint, smallint, text, text) SECURITY INVOKER;
ALTER FUNCTION public.lookup_syntax_tree_v1(integer, text) SECURITY INVOKER;
ALTER FUNCTION public.lookup_syntax_tree_v1(integer, integer, integer, text) SECURITY INVOKER;
ALTER FUNCTION public.validate_syntax_tree_integrity_v1() SECURITY INVOKER;
ALTER FUNCTION public.verify_referential_integrity_v1() SECURITY INVOKER;

-- 5. FIX FUNCTION SEARCH PATHS
ALTER FUNCTION public.get_jwt_claim(text) SET search_path = public;
ALTER FUNCTION public.get_my_shopify_id() SET search_path = public;
ALTER FUNCTION public.get_shopify_customer_id() SET search_path = public;
ALTER FUNCTION public.increment_help(bigint) SET search_path = public;
ALTER FUNCTION public.increment_prayed(bigint) SET search_path = public;
ALTER FUNCTION public.new_message(bigint, bigint, text) SET search_path = public;
ALTER FUNCTION public.record_donation(integer, numeric) SET search_path = public;
ALTER FUNCTION public.update_updated_at_column() SET search_path = public;
ALTER FUNCTION public.whoami_v1() SET search_path = public;
