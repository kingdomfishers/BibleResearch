-- Migration: 20261106153000_syntax_lookup_and_validation_rpc.sql
-- Description: Deterministic RPCs for syntax tree lookup, cross-verse structures, and integrity validation (F6-02)

-- 1. Deterministic Syntax Tree Lookup RPC: lookup_syntax_tree_v1
CREATE OR REPLACE FUNCTION public.lookup_syntax_tree_v1(
  p_verse_id integer,
  p_edition_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_verse record;
  v_edition record;
  v_has_syntax boolean := false;
  v_trees_json jsonb := '[]'::jsonb;
  v_edges_json jsonb := '[]'::jsonb;
  v_cross_spans_json jsonb := '[]'::jsonb;
  v_tree_ids text[];
BEGIN
  -- 1. Validate verse
  SELECT v.id, v.book, v.chapter, v.verse_nr
  INTO v_verse
  FROM public.verses v
  WHERE v.id = p_verse_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'error', 'Verse not found',
      'verse_id', p_verse_id
    );
  END IF;

  -- 2. Identify relevant trees that cover this verse
  -- A tree covers this verse if either:
  --   a) sn.verse_id = p_verse_id
  --   b) sn.is_cross_verse AND p_verse_id BETWEEN sn.verse_id AND sn.end_verse_id
  SELECT array_agg(DISTINCT sn.tree_id)
  INTO v_tree_ids
  FROM public.syntax_nodes sn
  JOIN public.source_editions se ON se.id = sn.edition_id
  WHERE sn.tree_id IS NOT NULL
    AND (
      sn.verse_id = p_verse_id
      OR (sn.is_cross_verse AND p_verse_id BETWEEN sn.verse_id AND sn.end_verse_id)
    )
    AND (p_edition_key IS NULL OR se.edition_key = p_edition_key);

  IF v_tree_ids IS NOT NULL AND array_length(v_tree_ids, 1) > 0 THEN
    v_has_syntax := true;

    -- Aggregate full hierarchical trees
    WITH tree_nodes AS (
      SELECT
        sn.id,
        sn.node_key,
        sn.parent_node_id,
        sn.tree_id,
        sn.depth,
        sn.sibling_order,
        sn.node_type,
        sn.class_label,
        sn.rule_label,
        sn.cl_type,
        sn.syntactic_role,
        sn.is_head,
        sn.is_terminal,
        sn.start_word_position,
        sn.end_word_position,
        sn.verse_id,
        sn.end_verse_id,
        sn.is_cross_verse,
        sn.terminal_xml_id,
        sn.terminal_word_id,
        w.original_word AS surface_word,
        w.transliteration AS word_transliteration,
        w.strongs_nr AS word_strongs,
        w.grammar_code AS word_grammar,
        sn.semantic_frame,
        se.edition_key,
        se.title AS edition_title
      FROM public.syntax_nodes sn
      JOIN public.source_editions se ON se.id = sn.edition_id
      LEFT JOIN public.words w ON w.id = sn.terminal_word_id
      WHERE sn.tree_id = ANY(v_tree_ids)
        AND (p_edition_key IS NULL OR se.edition_key = p_edition_key)
      ORDER BY sn.tree_id, sn.depth, sn.sibling_order, sn.id
    ),
    grouped_trees AS (
      SELECT
        tn.tree_id,
        tn.edition_key,
        tn.edition_title,
        bool_or(tn.is_cross_verse) AS is_cross_verse,
        min(tn.verse_id) AS start_verse_id,
        max(tn.end_verse_id) AS end_verse_id,
        (SELECT sv.chapter || ':' || sv.verse_nr FROM public.verses sv WHERE sv.id = min(tn.verse_id)) AS start_ref,
        (SELECT ev.chapter || ':' || ev.verse_nr FROM public.verses ev WHERE ev.id = max(tn.end_verse_id)) AS end_ref,
        (SELECT tn2.id FROM tree_nodes tn2 WHERE tn2.tree_id = tn.tree_id AND tn2.parent_node_id IS NULL LIMIT 1) AS root_node_id,
        jsonb_agg(
          jsonb_build_object(
            'id', tn.id,
            'node_key', tn.node_key,
            'parent_node_id', tn.parent_node_id,
            'depth', tn.depth,
            'sibling_order', tn.sibling_order,
            'node_type', tn.node_type,
            'class_label', tn.class_label,
            'rule_label', tn.rule_label,
            'cl_type', tn.cl_type,
            'syntactic_role', tn.syntactic_role,
            'is_head', tn.is_head,
            'is_terminal', tn.is_terminal,
            'start_word_position', tn.start_word_position,
            'end_word_position', tn.end_word_position,
            'verse_id', tn.verse_id,
            'end_verse_id', tn.end_verse_id,
            'is_cross_verse', tn.is_cross_verse,
            'terminal_xml_id', tn.terminal_xml_id,
            'terminal_word_id', tn.terminal_word_id,
            'surface_word', tn.surface_word,
            'word_transliteration', tn.word_transliteration,
            'word_strongs', tn.word_strongs,
            'word_grammar', tn.word_grammar,
            'semantic_frame', tn.semantic_frame
          ) ORDER BY tn.depth, tn.sibling_order, tn.id
        ) AS nodes_json
      FROM tree_nodes tn
      GROUP BY tn.tree_id, tn.edition_key, tn.edition_title
    )
    SELECT
      coalesce(jsonb_agg(
        jsonb_build_object(
          'tree_id', gt.tree_id,
          'edition_key', gt.edition_key,
          'edition_title', gt.edition_title,
          'is_cross_verse', gt.is_cross_verse,
          'start_verse_id', gt.start_verse_id,
          'end_verse_id', gt.end_verse_id,
          'cross_verse_span', CASE WHEN gt.is_cross_verse THEN gt.start_ref || '–' || gt.end_ref ELSE NULL END,
          'root_node_id', gt.root_node_id,
          'nodes_count', jsonb_array_length(gt.nodes_json),
          'nodes', gt.nodes_json
        ) ORDER BY gt.tree_id
      ), '[]'::jsonb)
    INTO v_trees_json
    FROM grouped_trees gt;

    -- Aggregate edges between tree nodes
    SELECT
      coalesce(jsonb_agg(
        jsonb_build_object(
          'id', se.id,
          'source_node_id', se.source_node_id,
          'target_node_id', se.target_node_id,
          'relation_type', se.relation_type,
          'raw_relation_tag', se.raw_relation_tag,
          'dependent_word_position', se.dependent_word_position,
          'head_word_position', se.head_word_position
        ) ORDER BY se.id
      ), '[]'::jsonb)
    INTO v_edges_json
    FROM public.syntax_edges se
    JOIN public.syntax_nodes sn ON sn.id = se.target_node_id
    WHERE sn.tree_id = ANY(v_tree_ids);

    -- Cross-verse spans summary
    SELECT
      coalesce(jsonb_agg(
        jsonb_build_object(
          'tree_id', sn.tree_id,
          'start_verse_id', sn.verse_id,
          'end_verse_id', sn.end_verse_id,
          'span_length_verses', sn.end_verse_id - sn.verse_id + 1,
          'rule', sn.rule_label,
          'class', sn.class_label
        )
      ), '[]'::jsonb)
    INTO v_cross_spans_json
    FROM public.syntax_nodes sn
    WHERE sn.tree_id = ANY(v_tree_ids)
      AND sn.is_cross_verse = true
      AND sn.parent_node_id IS NULL;
  END IF;

  RETURN jsonb_build_object(
    'verse_id', p_verse_id,
    'book', v_verse.book,
    'chapter', v_verse.chapter,
    'verse_nr', v_verse.verse_nr,
    'has_syntax', v_has_syntax,
    'syntax_status', CASE WHEN v_has_syntax THEN 'annotated_in_source' ELSE 'unannotated_in_source' END,
    'missing_syntax_reason', CASE
      WHEN NOT v_has_syntax THEN 'No syntax tree bank annotations exist in declared sources for this verse. Syntax is not algorithmically guessed.'
      ELSE NULL
    END,
    'trees_count', jsonb_array_length(v_trees_json),
    'trees', v_trees_json,
    'edges_count', jsonb_array_length(v_edges_json),
    'edges', v_edges_json,
    'cross_verse_spans', v_cross_spans_json,
    'epistemic_invariants', jsonb_build_object(
      'morphology_vs_syntax_distinction', 'Word morphology describes parts of speech; syntax tree describes hierarchical constituent grammar (phrases & clauses).',
      'semantic_role_grounding', 'Semantic frames (A0, A1) are emitted only when explicitly annotated upstream by MACULA.',
      'unannotated_policy', 'Missing syntax is reported explicitly as unannotated rather than approximated or guessed.',
      'cross_verse_preservation', 'Multi-verse clauses and sentences span verse boundaries without artificial truncation.'
    )
  );
END;
$$;

COMMENT ON FUNCTION public.lookup_syntax_tree_v1 IS
  'Deterministic lookup for MACULA hierarchical syntax trees, clause/phrase structures, grammatical roles, semantic frames, and cross-verse spans.';

GRANT EXECUTE ON FUNCTION public.lookup_syntax_tree_v1 TO anon, authenticated, service_role;


-- 2. Syntax Tree Structural Integrity Validator: validate_syntax_tree_integrity_v1
CREATE OR REPLACE FUNCTION public.validate_syntax_tree_integrity_v1()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_total_nodes bigint;
  v_total_edges bigint;
  v_cycles_count bigint := 0;
  v_orphaned_parents bigint := 0;
  v_span_inversions bigint := 0;
  v_verse_inversions bigint := 0;
  v_terminals_without_xml bigint := 0;
  v_cross_verse_count bigint := 0;
  v_max_depth integer := 0;
  v_is_valid boolean := true;
  v_reasons text[] := ARRAY[]::text[];
BEGIN
  -- Total counts
  SELECT count(*) INTO v_total_nodes FROM public.syntax_nodes;
  SELECT count(*) INTO v_total_edges FROM public.syntax_edges;

  -- 1. Cycles check (self-parent is checked by constraint; check any parent depth inversions)
  SELECT count(*)
  INTO v_cycles_count
  FROM public.syntax_nodes child
  JOIN public.syntax_nodes parent ON parent.id = child.parent_node_id
  WHERE child.depth <= parent.depth;

  IF v_cycles_count > 0 THEN
    v_is_valid := false;
    v_reasons := array_append(v_reasons, 'Depth inversion detected: ' || v_cycles_count || ' children have depth <= parent depth.');
  END IF;

  -- 2. Orphaned parents (parent_node_id points to non-existent node)
  SELECT count(*)
  INTO v_orphaned_parents
  FROM public.syntax_nodes child
  WHERE child.parent_node_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.syntax_nodes p WHERE p.id = child.parent_node_id);

  IF v_orphaned_parents > 0 THEN
    v_is_valid := false;
    v_reasons := array_append(v_reasons, 'Orphaned parent references: ' || v_orphaned_parents || ' nodes reference non-existent parents.');
  END IF;

  -- 3. Span inversions (start > end)
  SELECT count(*)
  INTO v_span_inversions
  FROM public.syntax_nodes
  WHERE start_word_position > end_word_position;

  IF v_span_inversions > 0 THEN
    v_is_valid := false;
    v_reasons := array_append(v_reasons, 'Span inversions detected: ' || v_span_inversions || ' nodes have start > end word position.');
  END IF;

  -- 4. Verse inversions (verse_id > end_verse_id)
  SELECT count(*)
  INTO v_verse_inversions
  FROM public.syntax_nodes
  WHERE end_verse_id IS NOT NULL AND verse_id > end_verse_id;

  IF v_verse_inversions > 0 THEN
    v_is_valid := false;
    v_reasons := array_append(v_reasons, 'Verse inversions detected: ' || v_verse_inversions || ' nodes have verse_id > end_verse_id.');
  END IF;

  -- 5. Terminal nodes without XML ID
  SELECT count(*)
  INTO v_terminals_without_xml
  FROM public.syntax_nodes
  WHERE is_terminal = true AND (terminal_xml_id IS NULL OR btrim(terminal_xml_id) = '');

  IF v_terminals_without_xml > 0 THEN
    v_is_valid := false;
    v_reasons := array_append(v_reasons, 'Terminal nodes without XML ID: ' || v_terminals_without_xml || ' nodes lack source xml_id.');
  END IF;

  -- 6. Cross-verse count and max depth
  SELECT count(*) INTO v_cross_verse_count FROM public.syntax_nodes WHERE is_cross_verse = true;
  SELECT coalesce(max(depth), 0) INTO v_max_depth FROM public.syntax_nodes;

  RETURN jsonb_build_object(
    'is_valid', v_is_valid,
    'status', CASE WHEN v_is_valid THEN 'PASS' ELSE 'FAIL' END,
    'total_nodes', v_total_nodes,
    'total_edges', v_total_edges,
    'max_depth', v_max_depth,
    'cross_verse_nodes_count', v_cross_verse_count,
    'cycles_count', v_cycles_count,
    'orphaned_parents_count', v_orphaned_parents,
    'span_inversions_count', v_span_inversions,
    'verse_inversions_count', v_verse_inversions,
    'terminals_without_xml_count', v_terminals_without_xml,
    'failure_reasons', v_reasons
  );
END;
$$;

COMMENT ON FUNCTION public.validate_syntax_tree_integrity_v1 IS
  'Deterministic validation of syntax tree structure asserting acyclicity, valid hierarchy, 0 span inversions, and traceable terminal tokens.';

GRANT EXECUTE ON FUNCTION public.validate_syntax_tree_integrity_v1 TO anon, authenticated, service_role;
