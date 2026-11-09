-- Applied LIVE in Supabase already. For LOCAL migration-history reconciliation ONLY. DO NOT blindly re-execute against the same DB.

CREATE TABLE IF NOT EXISTS bible_internal.b7_greek_terminal_repair_20261109 (
    syntax_node_id bigint PRIMARY KEY,
    source_token_id bigint NOT NULL,
    original_word_id integer,
    corrected_word_id integer,
    original_verse_id integer NOT NULL,
    matched_verse_id integer NOT NULL,
    source_edition_id bigint NOT NULL,
    source_xml_id text NOT NULL,
    source_link_status text NOT NULL,
    preserved_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE bible_internal.b7_greek_terminal_repair_20261109 FROM PUBLIC, anon, authenticated;
DO $b7$
DECLARE
    v_expected integer;
    v_saved integer;
    v_updated integer;
    v_remaining integer;
BEGIN
    WITH candidate AS (
      SELECT sn.id node_id, sn.terminal_word_id original_id,gt.step_word_id target_id,
             sn.verse_id syntax_vid,gt.canonical_verse_id token_vid,
             gt.link_status,gt.id token_id
      FROM public.syntax_nodes sn
      JOIN public.source_editions e ON e.id=sn.edition_id
      JOIN public.macula_greek_tokens gt ON gt.source_edition_id=sn.edition_id AND gt.xml_id=sn.terminal_xml_id
      WHERE e.edition_key LIKE 'macula-greek%' AND sn.is_terminal
        AND sn.terminal_word_id IS DISTINCT FROM gt.step_word_id
    )
    SELECT count(*) INTO v_expected FROM candidate
    WHERE syntax_vid=token_vid
      AND ((link_status='exact_form' AND target_id IS NOT NULL)
            OR (link_status='unmatched' AND target_id IS NULL))
      AND (target_id IS NULL OR EXISTS(
        SELECT 1 FROM public.verses v WHERE v.id=token_vid AND target_id=ANY(v.word_ids)));

    IF v_expected<>956 THEN
       RAISE EXCEPTION 'Expected 956 unambiguous Greek syntax repairs; found %; refusing any update',v_expected;
    END IF;

    IF EXISTS (
      SELECT sn.id
      FROM public.syntax_nodes sn
      JOIN public.source_editions e ON e.id=sn.edition_id
      JOIN public.macula_greek_tokens gt ON gt.source_edition_id=sn.edition_id AND gt.xml_id=sn.terminal_xml_id
      WHERE e.edition_key LIKE 'macula-greek%' AND sn.is_terminal
        AND sn.terminal_word_id IS DISTINCT FROM gt.step_word_id
      GROUP BY sn.id HAVING count(*) <> 1
    ) THEN RAISE EXCEPTION 'Ambiguous Greek XML terminal join'; END IF;

    INSERT INTO bible_internal.b7_greek_terminal_repair_20261109
      (syntax_node_id,source_token_id,original_word_id,corrected_word_id,
       original_verse_id,matched_verse_id,source_edition_id,source_xml_id,source_link_status)
    SELECT sn.id,gt.id,sn.terminal_word_id,gt.step_word_id,
           sn.verse_id,gt.canonical_verse_id,sn.edition_id,sn.terminal_xml_id,gt.link_status
    FROM public.syntax_nodes sn
    JOIN public.source_editions e ON e.id=sn.edition_id
    JOIN public.macula_greek_tokens gt ON gt.source_edition_id=sn.edition_id AND gt.xml_id=sn.terminal_xml_id
    WHERE e.edition_key LIKE 'macula-greek%' AND sn.is_terminal
      AND sn.terminal_word_id IS DISTINCT FROM gt.step_word_id
      AND sn.verse_id=gt.canonical_verse_id
      AND ((gt.link_status='exact_form' AND gt.step_word_id IS NOT NULL)
          OR (gt.link_status='unmatched' AND gt.step_word_id IS NULL));
    GET DIAGNOSTICS v_saved=ROW_COUNT;
    IF v_saved<>956 THEN RAISE EXCEPTION 'Expected 956 backed-up rows, saved %',v_saved; END IF;

    UPDATE public.syntax_nodes sn
    SET terminal_word_id=b.corrected_word_id
    FROM bible_internal.b7_greek_terminal_repair_20261109 b
    WHERE sn.id=b.syntax_node_id
      AND sn.terminal_word_id IS NOT DISTINCT FROM b.original_word_id;
    GET DIAGNOSTICS v_updated=ROW_COUNT;
    IF v_updated<>956 THEN RAISE EXCEPTION 'Expected 956 syntax fixes, updated %',v_updated; END IF;

    SELECT count(*) INTO v_remaining
    FROM public.syntax_nodes sn
    JOIN public.source_editions e ON e.id=sn.edition_id
    JOIN public.macula_greek_tokens gt ON gt.source_edition_id=sn.edition_id AND gt.xml_id=sn.terminal_xml_id
    WHERE e.edition_key LIKE 'macula-greek%' AND sn.is_terminal
      AND sn.terminal_word_id IS DISTINCT FROM gt.step_word_id;
    IF v_remaining<>0 THEN RAISE EXCEPTION 'Greek terminal integrity remains failed: % mismatches',v_remaining; END IF;
END
$b7$;
