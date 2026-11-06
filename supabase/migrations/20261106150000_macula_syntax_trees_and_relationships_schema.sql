-- Migration: 20261106150000_macula_syntax_trees_and_relationships_schema.sql
-- Description: Additive schema migration for full hierarchical MACULA syntax trees, parent-child links, cross-verse spans, and batch ingestion (F6-01)

-- 1. Enhance public.syntax_nodes with tree hierarchy, cross-verse, and terminal mapping columns
ALTER TABLE public.syntax_nodes DROP CONSTRAINT IF EXISTS syntax_nodes_node_type_check;
ALTER TABLE public.syntax_nodes ADD CONSTRAINT syntax_nodes_node_type_check
  CHECK (node_type IN (
    'sentence',
    'clause',
    'phrase',
    'conjoined_phrase',
    'compound_word_group',
    'terminal',
    'token'
  ));

ALTER TABLE public.syntax_nodes
  ADD COLUMN IF NOT EXISTS parent_node_id bigint REFERENCES public.syntax_nodes(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS tree_id text,
  ADD COLUMN IF NOT EXISTS depth integer NOT NULL DEFAULT 0 CHECK (depth >= 0),
  ADD COLUMN IF NOT EXISTS sibling_order integer NOT NULL DEFAULT 0 CHECK (sibling_order >= 0),
  ADD COLUMN IF NOT EXISTS class_label text,
  ADD COLUMN IF NOT EXISTS rule_label text,
  ADD COLUMN IF NOT EXISTS cl_type text,
  ADD COLUMN IF NOT EXISTS is_head boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_terminal boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS terminal_xml_id text,
  ADD COLUMN IF NOT EXISTS terminal_word_id integer REFERENCES public.words(id),
  ADD COLUMN IF NOT EXISTS semantic_frame text,
  ADD COLUMN IF NOT EXISTS end_verse_id integer REFERENCES public.verses(id),
  ADD COLUMN IF NOT EXISTS is_cross_verse boolean NOT NULL DEFAULT false;

-- Strict acyclicity constraint: a node cannot be its own parent
ALTER TABLE public.syntax_nodes DROP CONSTRAINT IF EXISTS chk_syntax_nodes_no_self_parent;
ALTER TABLE public.syntax_nodes ADD CONSTRAINT chk_syntax_nodes_no_self_parent
  CHECK (parent_node_id IS NULL OR parent_node_id <> id);

-- Indexes for tree traversal and terminal mapping
CREATE INDEX IF NOT EXISTS idx_syntax_nodes_parent ON public.syntax_nodes (parent_node_id);
CREATE INDEX IF NOT EXISTS idx_syntax_nodes_tree ON public.syntax_nodes (tree_id);
CREATE INDEX IF NOT EXISTS idx_syntax_nodes_terminal_xml ON public.syntax_nodes (terminal_xml_id);
CREATE INDEX IF NOT EXISTS idx_syntax_nodes_terminal_word ON public.syntax_nodes (terminal_word_id);
CREATE INDEX IF NOT EXISTS idx_syntax_nodes_cross_verse ON public.syntax_nodes (is_cross_verse) WHERE is_cross_verse = true;
CREATE INDEX IF NOT EXISTS idx_mgt_xml_id ON public.macula_greek_tokens (xml_id);

-- 2. Enhance public.syntax_edges with tree grammatical relation types
ALTER TABLE public.syntax_edges DROP CONSTRAINT IF EXISTS syntax_edges_relation_type_check;
ALTER TABLE public.syntax_edges ADD CONSTRAINT syntax_edges_relation_type_check
  CHECK (relation_type IN (
    'parent_child',
    'head_complement',
    'subject',
    'object',
    'predicate',
    'modifier',
    'specifier',
    'conjunction',
    'clause_dependency',
    'conjoin_forward_head',
    'conjoin_backward_head',
    'prefix_to_stem',
    'suffix_to_stem',
    'modifier_attachment'
  ));

-- Drop positional unique constraint on syntax_edges to support non-terminal tree edges
ALTER TABLE public.syntax_edges DROP CONSTRAINT IF EXISTS syntax_edges_edition_id_verse_id_dependent_word_position_he_key;

-- Add node-based unique index for tree structural edges
CREATE UNIQUE INDEX IF NOT EXISTS idx_syntax_edges_unique_nodes
  ON public.syntax_edges (edition_id, source_node_id, target_node_id, relation_type)
  WHERE source_node_id IS NOT NULL AND target_node_id IS NOT NULL;

-- 3. Batch Ingestion RPC: ingest_syntax_tree_batch_v1
CREATE OR REPLACE FUNCTION public.ingest_syntax_tree_batch_v1(
  p_nodes jsonb,
  p_edges jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_inserted_nodes integer := 0;
  v_updated_nodes integer := 0;
  v_inserted_edges integer := 0;
  v_node jsonb;
  v_edge jsonb;
  v_parent_id bigint;
  v_terminal_word_id integer;
  v_source_node_id bigint;
  v_target_node_id bigint;
  v_node_id bigint;
BEGIN
  -- 1. Insert or update nodes
  FOR v_node IN SELECT * FROM jsonb_array_elements(p_nodes)
  LOOP
    -- Resolve parent_node_id by parent_node_key if supplied
    v_parent_id := NULL;
    IF v_node->>'parent_node_key' IS NOT NULL AND btrim(v_node->>'parent_node_key') <> '' THEN
      SELECT id INTO v_parent_id
      FROM public.syntax_nodes
      WHERE node_key = v_node->>'parent_node_key';
    END IF;

    -- Resolve terminal_word_id if terminal_xml_id provided
    v_terminal_word_id := NULL;
    IF v_node->>'terminal_word_id' IS NOT NULL THEN
      v_terminal_word_id := (v_node->>'terminal_word_id')::integer;
    ELSIF v_node->>'terminal_xml_id' IS NOT NULL AND btrim(v_node->>'terminal_xml_id') <> '' THEN
      -- Try Hebrew morphemes first
      SELECT m.word_id INTO v_terminal_word_id
      FROM public.macula_hebrew_morphemes m
      WHERE m.macula_id = v_node->>'terminal_xml_id'
      LIMIT 1;

      -- If not found, try Greek tokens
      IF v_terminal_word_id IS NULL THEN
        SELECT g.step_word_id INTO v_terminal_word_id
        FROM public.macula_greek_tokens g
        WHERE g.xml_id = v_node->>'terminal_xml_id'
        LIMIT 1;
      END IF;
    END IF;

    -- Upsert syntax_node
    INSERT INTO public.syntax_nodes (
      node_key,
      edition_id,
      verse_id,
      node_type,
      start_word_position,
      end_word_position,
      head_word_position,
      syntactic_role,
      grammar_summary,
      source_release_id,
      source_record_id,
      parent_node_id,
      tree_id,
      depth,
      sibling_order,
      class_label,
      rule_label,
      cl_type,
      is_head,
      is_terminal,
      terminal_xml_id,
      terminal_word_id,
      semantic_frame,
      end_verse_id,
      is_cross_verse
    ) VALUES (
      v_node->>'node_key',
      (v_node->>'edition_id')::bigint,
      (v_node->>'verse_id')::integer,
      v_node->>'node_type',
      (v_node->>'start_word_position')::integer,
      (v_node->>'end_word_position')::integer,
      (v_node->>'head_word_position')::integer,
      v_node->>'syntactic_role',
      v_node->>'grammar_summary',
      (v_node->>'source_release_id')::bigint,
      v_node->>'source_record_id',
      v_parent_id,
      v_node->>'tree_id',
      coalesce((v_node->>'depth')::integer, 0),
      coalesce((v_node->>'sibling_order')::integer, 0),
      v_node->>'class_label',
      v_node->>'rule_label',
      v_node->>'cl_type',
      coalesce((v_node->>'is_head')::boolean, false),
      coalesce((v_node->>'is_terminal')::boolean, false),
      v_node->>'terminal_xml_id',
      v_terminal_word_id,
      v_node->>'semantic_frame',
      coalesce((v_node->>'end_verse_id')::integer, (v_node->>'verse_id')::integer),
      coalesce((v_node->>'is_cross_verse')::boolean, false)
    )
    ON CONFLICT (node_key) DO UPDATE SET
      edition_id = EXCLUDED.edition_id,
      verse_id = EXCLUDED.verse_id,
      node_type = EXCLUDED.node_type,
      start_word_position = EXCLUDED.start_word_position,
      end_word_position = EXCLUDED.end_word_position,
      head_word_position = EXCLUDED.head_word_position,
      syntactic_role = EXCLUDED.syntactic_role,
      grammar_summary = EXCLUDED.grammar_summary,
      source_release_id = EXCLUDED.source_release_id,
      source_record_id = EXCLUDED.source_record_id,
      parent_node_id = EXCLUDED.parent_node_id,
      tree_id = EXCLUDED.tree_id,
      depth = EXCLUDED.depth,
      sibling_order = EXCLUDED.sibling_order,
      class_label = EXCLUDED.class_label,
      rule_label = EXCLUDED.rule_label,
      cl_type = EXCLUDED.cl_type,
      is_head = EXCLUDED.is_head,
      is_terminal = EXCLUDED.is_terminal,
      terminal_xml_id = EXCLUDED.terminal_xml_id,
      terminal_word_id = EXCLUDED.terminal_word_id,
      semantic_frame = EXCLUDED.semantic_frame,
      end_verse_id = EXCLUDED.end_verse_id,
      is_cross_verse = EXCLUDED.is_cross_verse;

    v_inserted_nodes := v_inserted_nodes + 1;
  END LOOP;

  -- 2. Insert edges if provided
  IF p_edges IS NOT NULL AND jsonb_array_length(p_edges) > 0 THEN
    FOR v_edge IN SELECT * FROM jsonb_array_elements(p_edges)
    LOOP
      v_source_node_id := NULL;
      v_target_node_id := NULL;

      IF v_edge->>'source_node_key' IS NOT NULL THEN
        SELECT id INTO v_source_node_id FROM public.syntax_nodes WHERE node_key = v_edge->>'source_node_key';
      END IF;

      IF v_edge->>'target_node_key' IS NOT NULL THEN
        SELECT id INTO v_target_node_id FROM public.syntax_nodes WHERE node_key = v_edge->>'target_node_key';
      END IF;

      INSERT INTO public.syntax_edges (
        edition_id,
        verse_id,
        dependent_word_position,
        head_word_position,
        source_node_id,
        target_node_id,
        relation_type,
        head_strongs,
        raw_relation_tag,
        source_release_id,
        source_record_id,
        origin_mode,
        derivation_method,
        algorithm_version
      ) VALUES (
        (v_edge->>'edition_id')::bigint,
        (v_edge->>'verse_id')::integer,
        coalesce((v_edge->>'dependent_word_position')::integer, 1),
        coalesce((v_edge->>'head_word_position')::integer, 1),
        v_source_node_id,
        v_target_node_id,
        v_edge->>'relation_type',
        v_edge->>'head_strongs',
        v_edge->>'raw_relation_tag',
        (v_edge->>'source_release_id')::bigint,
        v_edge->>'source_record_id',
        coalesce(v_edge->>'origin_mode', 'directly_imported'),
        coalesce(v_edge->>'derivation_method', 'Parsed from Clear-Bible MACULA Lowfat XML treebanks'),
        v_edge->>'algorithm_version'
      )
      ON CONFLICT DO NOTHING;

      v_inserted_edges := v_inserted_edges + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'nodes_processed', v_inserted_nodes,
    'edges_processed', v_inserted_edges
  );
END;
$$;

COMMENT ON FUNCTION public.ingest_syntax_tree_batch_v1 IS
  'Deterministic batch ingestion for MACULA Hebrew and Greek hierarchical syntax trees with parent-child linkage, spans, and terminal token associations.';

GRANT EXECUTE ON FUNCTION public.ingest_syntax_tree_batch_v1 TO anon, authenticated, service_role;
