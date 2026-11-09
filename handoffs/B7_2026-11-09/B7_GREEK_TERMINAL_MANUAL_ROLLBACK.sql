-- MANUAL EMERGENCY ROLLBACK TEMPLATE ONLY. DO NOT EXECUTE BY DEFAULT.
-- Requires explicit decision to revert LIVE migration b7_reconcile_greek_syntax_terminals_to_source_xml_tokens_20261109.
-- Original 956 rows are stored in bible_internal.b7_greek_terminal_repair_20261109.
-- This block deliberately stops if live records have changed since the correction.
BEGIN;
DO $revert$
DECLARE n integer;
BEGIN
SELECT count(*) INTO n FROM bible_internal.b7_greek_terminal_repair_20261109;
IF n <> 956 THEN RAISE EXCEPTION 'Backup is incomplete (count=%)', n; END IF;
IF EXISTS(
 SELECT 1 FROM bible_internal.b7_greek_terminal_repair_20261109 b
 JOIN public.syntax_nodes sn ON sn.id=b.syntax_node_id
 WHERE sn.terminal_word_id IS DISTINCT FROM b.corrected_word_id
) THEN RAISE EXCEPTION 'Current nodes changed after migration; refusing rollback'; END IF;
UPDATE public.syntax_nodes sn SET terminal_word_id=b.original_word_id
FROM bible_internal.b7_greek_terminal_repair_20261109 b
WHERE sn.id=b.syntax_node_id;
GET DIAGNOSTICS n=ROW_COUNT;
IF n<>956 THEN RAISE EXCEPTION 'Rollback changed %, expected 956',n; END IF;
END $revert$;
-- Replace ROLLBACK with COMMIT only after explicit approval and verification.
ROLLBACK;
