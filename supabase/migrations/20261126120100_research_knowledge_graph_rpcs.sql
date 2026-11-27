-- Research Knowledge Graph: Read/Traversal RPCs and Transactional Write/Review Core
-- Read RPCs run SECURITY INVOKER (RLS-enforced). Agent write RPCs are service_role only.

BEGIN;

-- ============================================================================
-- 1. Helper: Resolve node reference (SECURITY INVOKER + visibility fence)
-- ============================================================================
DROP FUNCTION IF EXISTS public.rg_resolve_node_id_v1(text);
CREATE OR REPLACE FUNCTION public.rg_resolve_node_id_v1(p_ref text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = ''
SET jit = 'off'
AS $$
DECLARE
  v_trim text := nullif(btrim(coalesce(p_ref, '')), '');
  v_id uuid;
BEGIN
  IF v_trim IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_trim ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id INTO v_id FROM public.rg_nodes
    WHERE id = v_trim::uuid
      AND ((visibility = 'public' AND status IN ('active', 'published')) OR (owner_user_id IS NOT NULL AND owner_user_id = (SELECT auth.uid())));
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;

  SELECT id INTO v_id FROM public.rg_nodes
  WHERE node_key = v_trim
    AND ((visibility = 'public' AND status IN ('active', 'published')) OR (owner_user_id IS NOT NULL AND owner_user_id = (SELECT auth.uid())))
  LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  IF v_trim ~* '^[HG]\d{1,5}[A-Za-z]?$' THEN
    SELECT id INTO v_id
    FROM public.rg_nodes
    WHERE upper(strongs_code) = upper(v_trim)
      AND ((visibility = 'public' AND status IN ('active', 'published')) OR (owner_user_id IS NOT NULL AND owner_user_id = (SELECT auth.uid())))
    ORDER BY (node_key LIKE 'canon:lemma:%') DESC, created_at ASC
    LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;

  SELECT id INTO v_id
  FROM public.rg_nodes
  WHERE lower(label) = lower(v_trim)
    AND ((visibility = 'public' AND status IN ('active', 'published')) OR (owner_user_id IS NOT NULL AND owner_user_id = (SELECT auth.uid())))
  ORDER BY created_at ASC
  LIMIT 1;

  RETURN v_id;
END;
$$;

-- ============================================================================
-- 2. Read RPC: Resolve entities across rg_nodes and canonical tables
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rg_resolve_entity_v1(
  p_query text,
  p_kinds text[] DEFAULT NULL,
  p_limit integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
SET statement_timeout = '8s'
SET jit = 'off'
AS $$
DECLARE
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_rg_matches jsonb := '[]'::jsonb;
  v_canon_matches jsonb := '[]'::jsonb;
BEGIN
  IF v_q IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'ok',
      'epistemic_layer', 'research_knowledge_graph',
      'query', p_query,
      'rg_nodes', '[]'::jsonb,
      'canonical_candidates', '[]'::jsonb
    );
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO v_rg_matches
  FROM (
    SELECT
      n.id,
      n.node_key,
      n.node_kind,
      n.origin_layer,
      n.label,
      n.original_script,
      n.transliteration,
      n.strongs_code,
      n.aliases,
      left(n.summary, 280) AS summary,
      n.disambiguation_note,
      n.verse_id,
      n.word_id,
      n.word_position,
      n.lemma_id,
      n.concept_id,
      n.place_id,
      n.event_id,
      n.author_kind,
      n.review_status,
      n.visibility
    FROM public.rg_nodes n
    WHERE n.status IN ('active', 'published')
      AND (p_kinds IS NULL OR n.node_kind = ANY(p_kinds))
      AND (
        n.node_key = v_q
        OR upper(coalesce(n.strongs_code, '')) = upper(v_q)
        OR n.label ILIKE '%' || v_q || '%'
        OR EXISTS (SELECT 1 FROM unnest(n.aliases) a WHERE a ILIKE '%' || v_q || '%')
        OR n.tsv @@ websearch_to_tsquery('english', v_q)
      )
    ORDER BY
      (n.node_key = v_q) DESC,
      (upper(coalesce(n.strongs_code, '')) = upper(v_q)) DESC,
      (lower(n.label) = lower(v_q)) DESC,
      n.updated_at DESC
    LIMIT v_limit
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(c)), '[]'::jsonb)
  INTO v_canon_matches
  FROM (
    (
      SELECT
        'lemma'::text AS node_kind,
        'canon:lemma:' || l.lemma_key AS suggested_node_key,
        l.lemma_script || ' (' || l.lemma_key || ')' AS label,
        l.lemma_script AS original_script,
        l.transliteration,
        l.lemma_key AS strongs_code,
        l.id AS lemma_id,
        NULL::integer AS verse_id,
        NULL::bigint AS concept_id,
        NULL::bigint AS place_id,
        NULL::bigint AS event_id,
        COALESCE((SELECT s.short_gloss FROM public.lexical_senses s WHERE s.lemma_id = l.id ORDER BY s.sense_order LIMIT 1), '') AS summary
      FROM public.lemmas l
      WHERE (p_kinds IS NULL OR 'lemma' = ANY(p_kinds))
        AND (
          upper(l.lemma_key) = upper(v_q)
          OR upper(l.base_strongs) = upper(v_q)
          OR l.lemma_script ILIKE '%' || v_q || '%'
          OR l.lemma_stripped ILIKE '%' || v_q || '%'
          OR l.transliteration ILIKE '%' || v_q || '%'
          OR EXISTS (
            SELECT 1 FROM public.lexical_senses ls
            WHERE ls.lemma_id = l.id AND ls.short_gloss ILIKE '%' || v_q || '%'
          )
        )
      ORDER BY (upper(l.lemma_key) = upper(v_q) OR upper(l.base_strongs) = upper(v_q)) DESC, l.id
      LIMIT least(v_limit, 10)
    )
    UNION ALL
    (
      SELECT
        'canonical_concept'::text AS node_kind,
        'canon:concept:' || cp.concept_key AS suggested_node_key,
        cp.title AS label,
        NULL::text AS original_script,
        NULL::text AS transliteration,
        cp.primary_strongs[1] AS strongs_code,
        NULL::bigint AS lemma_id,
        NULL::integer AS verse_id,
        cp.id AS concept_id,
        NULL::bigint AS place_id,
        NULL::bigint AS event_id,
        left(cp.summary, 240) AS summary
      FROM public.concepts cp
      WHERE (p_kinds IS NULL OR 'canonical_concept' = ANY(p_kinds) OR 'concept' = ANY(p_kinds))
        AND (cp.title ILIKE '%' || v_q || '%' OR cp.concept_key ILIKE '%' || v_q || '%')
      ORDER BY cp.id
      LIMIT least(v_limit, 6)
    )
    UNION ALL
    (
      SELECT
        'place'::text AS node_kind,
        'canon:place:' || pl.place_key AS suggested_node_key,
        pl.biblical_name AS label,
        coalesce(pl.hebrew_name, pl.greek_name) AS original_script,
        NULL::text AS transliteration,
        pl.strongs_numbers[1] AS strongs_code,
        NULL::bigint AS lemma_id,
        NULL::integer AS verse_id,
        NULL::bigint AS concept_id,
        pl.id AS place_id,
        NULL::bigint AS event_id,
        coalesce(pl.place_type, 'place') AS summary
      FROM public.places pl
      WHERE (p_kinds IS NULL OR 'place' = ANY(p_kinds))
        AND pl.published = true
        AND (pl.biblical_name ILIKE '%' || v_q || '%' OR pl.place_key ILIKE '%' || v_q || '%')
      ORDER BY pl.id
      LIMIT least(v_limit, 6)
    )
  ) c
  LIMIT v_limit;

  RETURN jsonb_build_object(
    'status', 'ok',
    'epistemic_layer', 'research_knowledge_graph',
    'query', v_q,
    'rg_nodes', v_rg_matches,
    'canonical_candidates', v_canon_matches
  );
END;
$$;

-- ============================================================================
-- 3. Read RPC: Search claims ranked by evidence quality, specificity & novelty
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rg_search_v1(
  p_query text DEFAULT NULL,
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
SET statement_timeout = '8s'
SET jit = 'off'
AS $$
DECLARE
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
  v_f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_author_kind text := nullif(v_f->>'author_kind', '');
  v_ev_class text := nullif(v_f->>'evidence_class', '');
  v_rev_status text := nullif(v_f->>'review_status', '');
  v_ep_state text := nullif(v_f->>'epistemic_state', '');
  v_predicate text := nullif(v_f->>'predicate', '');
  v_claim_kind text := nullif(v_f->>'claim_kind', '');
  v_node_kind text := nullif(v_f->>'node_kind', '');
  v_stale_only boolean := coalesce((v_f->>'is_potentially_stale')::boolean, false);
  v_include_superseded boolean := coalesce((v_f->>'include_superseded')::boolean, false);
  v_verse_id int := (v_f->>'verse_id')::int;
  v_lemma_id bigint := (v_f->>'lemma_id')::bigint;
  v_total int := 0;
  v_items jsonb := '[]'::jsonb;
BEGIN
  WITH base AS (
    SELECT
      c.*,
      sn.node_key AS subj_key,
      sn.label AS subj_label,
      sn.node_kind AS subj_kind,
      sn.original_script AS subj_script,
      sn.strongs_code AS subj_strongs,
      onode.node_key AS obj_key,
      onode.label AS obj_label,
      onode.node_kind AS obj_kind,
      onode.original_script AS obj_script,
      onode.strongs_code AS obj_strongs,
      ct.label AS predicate_label,
      ct.inverse_label AS predicate_inverse_label,
      ct.is_transitive AS predicate_is_transitive,
      ct.is_symmetric AS predicate_is_symmetric,
      ct.category AS predicate_category,
      na.display_name AS author_display_name,
      na.ai_provider,
      na.ai_model,
      (
        SELECT count(DISTINCT e.source_key)::int
        FROM public.rg_claim_evidence e
        WHERE e.claim_id = c.id AND e.polarity = 'supporting' AND e.is_primary_source = true
      ) AS independent_witness_count,
      (
        SELECT count(*)::int
        FROM public.rg_claim_links l
        WHERE l.to_claim_id = c.id AND l.link_type IN ('challenges', 'contradicts')
      ) + (
        SELECT count(*)::int
        FROM public.rg_claim_evidence e
        WHERE e.claim_id = c.id AND e.polarity IN ('counterexample', 'control')
      ) AS challenge_count,
      CASE WHEN v_q IS NOT NULL THEN ts_rank_cd(c.tsv, websearch_to_tsquery('english', v_q)) ELSE 0.0 END AS text_rank
    FROM public.rg_claims c
    JOIN public.note_authors na ON na.id = c.author_id
    JOIN public.note_connection_types ct ON ct.connection_type = c.predicate
    LEFT JOIN public.rg_nodes sn ON sn.id = c.subject_node_id
    LEFT JOIN public.rg_nodes onode ON onode.id = c.object_node_id
    WHERE c.status = 'published'
      AND (v_include_superseded OR c.review_status <> 'superseded')
      AND (v_author_kind IS NULL OR c.author_kind = v_author_kind)
      AND (v_ev_class IS NULL OR c.evidence_class = v_ev_class)
      AND (v_rev_status IS NULL OR c.review_status = v_rev_status)
      AND (v_ep_state IS NULL OR c.epistemic_state = v_ep_state)
      AND (v_predicate IS NULL OR c.predicate = v_predicate)
      AND (v_claim_kind IS NULL OR c.claim_kind = v_claim_kind)
      AND (NOT v_stale_only OR c.is_potentially_stale = true)
      AND (v_node_kind IS NULL OR sn.node_kind = v_node_kind OR onode.node_kind = v_node_kind)
      AND (
        v_verse_id IS NULL
        OR sn.verse_id = v_verse_id OR onode.verse_id = v_verse_id
        OR EXISTS (SELECT 1 FROM public.rg_claim_evidence e WHERE e.claim_id = c.id AND e.verse_id = v_verse_id)
      )
      AND (
        v_lemma_id IS NULL
        OR sn.lemma_id = v_lemma_id OR onode.lemma_id = v_lemma_id
        OR EXISTS (SELECT 1 FROM public.rg_claim_evidence e WHERE e.claim_id = c.id AND e.lemma_id = v_lemma_id)
      )
      AND (
        v_q IS NULL
        OR c.tsv @@ websearch_to_tsquery('english', v_q)
        OR c.title ILIKE '%' || v_q || '%'
        OR c.assertion_text ILIKE '%' || v_q || '%'
        OR sn.label ILIKE '%' || v_q || '%'
        OR onode.label ILIKE '%' || v_q || '%'
        OR upper(coalesce(sn.strongs_code, '')) = upper(v_q)
        OR upper(coalesce(onode.strongs_code, '')) = upper(v_q)
      )
  ),
  scored AS (
    SELECT
      *,
      (
        CASE review_status
          WHEN 'confirmed' THEN 30
          WHEN 'unreviewed' THEN 10
          WHEN 'disputed' THEN 2
          WHEN 'superseded' THEN -25
          WHEN 'rejected' THEN -50
          ELSE 0
        END
        + CASE evidence_class
          WHEN 'TEXT_EXPLICIT' THEN 25
          WHEN 'TEXT_LINGUISTIC' THEN 22
          WHEN 'TEXT_INTERTEXTUAL' THEN 18
          WHEN 'SCIENCE_EMPIRICAL' THEN 18
          WHEN 'TEXT_PATTERN' THEN 14
          WHEN 'DLM_HYPOTHESIS' THEN 6
          WHEN 'OPEN' THEN 4
          WHEN 'DISPUTED' THEN 2
          ELSE 0
        END
        + least(independent_witness_count, 5) * 8
        - CASE WHEN is_potentially_stale THEN 15 ELSE 0 END
        - CASE WHEN predicate IN ('related', 'other') THEN 8 ELSE 0 END
        + (text_rank * 25.0)
      )::numeric(8,2) AS quality_score
    FROM base
  )
  SELECT
    (SELECT count(*)::int FROM scored),
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'claim_key', s.claim_key,
          'claim_kind', s.claim_kind,
          'title', s.title,
          'assertion_text', s.assertion_text,
          'contextual_scope', s.contextual_scope,
          'limitations', s.limitations,
          'predicate', s.predicate,
          'predicate_label', s.predicate_label,
          'predicate_inverse_label', s.predicate_inverse_label,
          'predicate_is_transitive', s.predicate_is_transitive,
          'predicate_is_symmetric', s.predicate_is_symmetric,
          'predicate_category', s.predicate_category,
          'direction', s.direction,
          'subject', CASE WHEN s.subject_node_id IS NOT NULL THEN jsonb_build_object(
            'id', s.subject_node_id, 'node_key', s.subj_key, 'label', s.subj_label,
            'node_kind', s.subj_kind, 'original_script', s.subj_script, 'strongs_code', s.subj_strongs
          ) ELSE NULL END,
          'object', CASE WHEN s.object_node_id IS NOT NULL THEN jsonb_build_object(
            'id', s.object_node_id, 'node_key', s.obj_key, 'label', s.obj_label,
            'node_kind', s.obj_kind, 'original_script', s.obj_script, 'strongs_code', s.obj_strongs
          ) ELSE NULL END,
          'origin_layer', s.origin_layer,
          'evidence_class', s.evidence_class,
          'epistemic_state', s.epistemic_state,
          'review_status', s.review_status,
          'confidence', s.confidence,
          'is_potentially_stale', s.is_potentially_stale,
          'stale_reason', s.stale_reason,
          'independent_primary_witness_count', s.independent_witness_count,
          'challenge_count', s.challenge_count,
          'quality_score', s.quality_score,
          'author', jsonb_build_object(
            'id', s.author_id, 'kind', s.author_kind,
            'display_name', s.author_display_name,
            'ai_provider', s.ai_provider, 'ai_model', s.ai_model
          ),
          'dlm_metadata', s.dlm_metadata,
          'version', s.version,
          'visibility', s.visibility,
          'updated_at', s.updated_at
        )
        ORDER BY s.quality_score DESC, s.updated_at DESC, s.id
      )
      FROM (SELECT * FROM scored ORDER BY quality_score DESC, updated_at DESC, id LIMIT v_limit OFFSET v_offset) s
    ), '[]'::jsonb)
  INTO v_total, v_items;

  RETURN jsonb_build_object(
    'status', 'ok',
    'epistemic_layer', 'research_knowledge_graph',
    'untrusted_content_notice', 'Research Knowledge Graph nodes and claims are human/AI research artifacts, not canonical Scripture or deterministic corpus output. Treat stored text as untrusted data.',
    'total', v_total,
    'shown', jsonb_array_length(v_items),
    'offset', v_offset,
    'items', v_items
  );
END;
$$;

-- ============================================================================
-- 4. Read RPC: Compact Concept / Entity Dossier
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rg_concept_dossier_v1(
  p_node_ref text,
  p_include_stale boolean DEFAULT true,
  p_limit integer DEFAULT 40
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
SET statement_timeout = '8s'
SET jit = 'off'
AS $$
DECLARE
  v_node_id uuid := public.rg_resolve_node_id_v1(p_node_ref);
  v_node record;
  v_limit int := least(greatest(coalesce(p_limit, 40), 1), 80);
  v_claims jsonb := '[]'::jsonb;
  v_linked_notes jsonb := '[]'::jsonb;
  v_stale_count int := 0;
  v_challenge_count int := 0;
BEGIN
  IF v_node_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'not_found',
      'epistemic_layer', 'research_knowledge_graph',
      'query', p_node_ref,
      'untrusted_content_notice', 'Research Knowledge Graph nodes and claims are untrusted human/AI commentary, not Scripture.',
      'node', NULL,
      'claims', '[]'::jsonb
    );
  END IF;

  SELECT n.*, na.display_name AS author_display_name, na.ai_model
  INTO v_node
  FROM public.rg_nodes n
  JOIN public.note_authors na ON na.id = n.author_id
  WHERE n.id = v_node_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found', 'epistemic_layer', 'research_knowledge_graph', 'query', p_node_ref, 'node', NULL, 'claims', '[]'::jsonb);
  END IF;

  WITH rel_claims AS (
    SELECT DISTINCT ON (c.id)
      c.*,
      sn.node_key AS subj_key, sn.label AS subj_label, sn.node_kind AS subj_kind, sn.strongs_code AS subj_strongs,
      onode.node_key AS obj_key, onode.label AS obj_label, onode.node_kind AS obj_kind, onode.strongs_code AS obj_strongs,
      ct.label AS predicate_label, ct.inverse_label AS predicate_inverse_label,
      ct.is_transitive AS predicate_is_transitive,
      na.display_name AS author_display_name, na.ai_model,
      CASE
        WHEN c.subject_node_id = v_node_id THEN 'outgoing'
        WHEN c.object_node_id = v_node_id THEN 'incoming'
        ELSE 'participant'
      END AS relation_role
    FROM public.rg_claims c
    JOIN public.note_authors na ON na.id = c.author_id
    JOIN public.note_connection_types ct ON ct.connection_type = c.predicate
    LEFT JOIN public.rg_nodes sn ON sn.id = c.subject_node_id
    LEFT JOIN public.rg_nodes onode ON onode.id = c.object_node_id
    WHERE c.status = 'published'
      AND c.review_status <> 'superseded'
      AND (p_include_stale OR NOT c.is_potentially_stale)
      AND (
        c.subject_node_id = v_node_id
        OR c.object_node_id = v_node_id
        OR EXISTS (SELECT 1 FROM public.rg_claim_participants p WHERE p.claim_id = c.id AND p.node_id = v_node_id)
        OR EXISTS (SELECT 1 FROM public.rg_claim_evidence e WHERE e.claim_id = c.id AND e.node_id = v_node_id)
      )
    ORDER BY c.id, c.updated_at DESC
  ),
  ranked AS (
    SELECT * FROM rel_claims
    ORDER BY
      CASE review_status WHEN 'confirmed' THEN 0 WHEN 'unreviewed' THEN 1 WHEN 'disputed' THEN 2 ELSE 3 END,
      CASE evidence_class
        WHEN 'TEXT_EXPLICIT' THEN 0 WHEN 'TEXT_LINGUISTIC' THEN 1 WHEN 'TEXT_INTERTEXTUAL' THEN 2
        WHEN 'SCIENCE_EMPIRICAL' THEN 3 WHEN 'TEXT_PATTERN' THEN 4 WHEN 'DLM_HYPOTHESIS' THEN 5 ELSE 6
      END,
      updated_at DESC
    LIMIT v_limit
  )
  SELECT
    COALESCE((SELECT count(*)::int FROM ranked WHERE is_potentially_stale), 0),
    COALESCE((SELECT count(*)::int FROM ranked WHERE review_status = 'disputed' OR claim_kind = 'challenge_critique'), 0),
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'claim_key', r.claim_key,
          'claim_kind', r.claim_kind,
          'relation_role', r.relation_role,
          'title', r.title,
          'assertion_text', r.assertion_text,
          'contextual_scope', r.contextual_scope,
          'limitations', r.limitations,
          'unresolved_questions', r.unresolved_questions,
          'predicate', r.predicate,
          'predicate_label', r.predicate_label,
          'predicate_inverse_label', r.predicate_inverse_label,
          'predicate_is_transitive', r.predicate_is_transitive,
          'direction', r.direction,
          'subject', CASE WHEN r.subject_node_id IS NOT NULL THEN jsonb_build_object('id', r.subject_node_id, 'node_key', r.subj_key, 'label', r.subj_label, 'node_kind', r.subj_kind, 'strongs_code', r.subj_strongs) ELSE NULL END,
          'object', CASE WHEN r.object_node_id IS NOT NULL THEN jsonb_build_object('id', r.object_node_id, 'node_key', r.obj_key, 'label', r.obj_label, 'node_kind', r.obj_kind, 'strongs_code', r.obj_strongs) ELSE NULL END,
          'participants', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'node_id', pn.id, 'node_key', pn.node_key, 'label', pn.label,
              'role', cp.role, 'ordinal', cp.ordinal, 'slot_key', cp.slot_key, 'notes', cp.notes
            ) ORDER BY cp.ordinal)
            FROM public.rg_claim_participants cp
            JOIN public.rg_nodes pn ON pn.id = cp.node_id
            WHERE cp.claim_id = r.id
          ), '[]'::jsonb),
          'evidence', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'id', ev.id, 'polarity', ev.polarity, 'evidence_kind', ev.evidence_kind,
              'source_key', ev.source_key, 'verse_id', ev.verse_id, 'word_id', ev.word_id,
              'word_position', ev.word_position, 'lemma_id', ev.lemma_id,
              'target_claim_id', ev.target_claim_id, 'algorithm_evidence_id', ev.algorithm_evidence_id,
              'external_title', ev.external_title, 'external_url', ev.external_url,
              'explanation', ev.explanation, 'is_primary_source', ev.is_primary_source
            ) ORDER BY ev.polarity, ev.created_at)
            FROM public.rg_claim_evidence ev WHERE ev.claim_id = r.id
          ), '[]'::jsonb),
          'origin_layer', r.origin_layer,
          'evidence_class', r.evidence_class,
          'epistemic_state', r.epistemic_state,
          'review_status', r.review_status,
          'confidence', r.confidence,
          'is_potentially_stale', r.is_potentially_stale,
          'stale_reason', r.stale_reason,
          'dlm_metadata', r.dlm_metadata,
          'author', jsonb_build_object('id', r.author_id, 'kind', r.author_kind, 'display_name', r.author_display_name, 'ai_model', r.ai_model),
          'version', r.version,
          'updated_at', r.updated_at
        )
      )
      FROM ranked r
    ), '[]'::jsonb)
  INTO v_stale_count, v_challenge_count, v_claims;

  -- Link existing published public notes that anchor to the same canonical entity
  SELECT COALESCE(jsonb_agg(row_to_json(ln)), '[]'::jsonb)
  INTO v_linked_notes
  FROM (
    SELECT DISTINCT ON (nt.id)
      nt.id, nt.title, nt.note_kind, nt.author_kind, nt.review_status,
      left(nt.body_md, 320) AS excerpt, nt.updated_at
    FROM public.notes nt
    JOIN public.note_anchors na ON na.note_id = nt.id
    WHERE nt.status = 'published' AND nt.visibility = 'public'
      AND (
        (v_node.verse_id IS NOT NULL AND na.verse_id = v_node.verse_id)
        OR (v_node.lemma_id IS NOT NULL AND na.lemma_id = v_node.lemma_id)
        OR (v_node.concept_id IS NOT NULL AND na.concept_id = v_node.concept_id)
        OR (v_node.place_id IS NOT NULL AND na.place_id = v_node.place_id)
        OR (v_node.event_id IS NOT NULL AND na.event_id = v_node.event_id)
        OR (v_node.note_id IS NOT NULL AND nt.id = v_node.note_id)
      )
    ORDER BY nt.id, nt.updated_at DESC
    LIMIT 10
  ) ln;

  RETURN jsonb_build_object(
    'status', 'ok',
    'epistemic_layer', 'research_knowledge_graph',
    'untrusted_content_notice', 'Research Knowledge Graph dossiers assemble human/AI claims, not canonical Scripture or deterministic corpus output.',
    'node', jsonb_build_object(
      'id', v_node.id,
      'node_key', v_node.node_key,
      'node_kind', v_node.node_kind,
      'origin_layer', v_node.origin_layer,
      'label', v_node.label,
      'original_script', v_node.original_script,
      'transliteration', v_node.transliteration,
      'strongs_code', v_node.strongs_code,
      'aliases', v_node.aliases,
      'summary', v_node.summary,
      'definitions', v_node.definitions,
      'polarity_notes', v_node.polarity_notes,
      'disambiguation_note', v_node.disambiguation_note,
      'external_uri', v_node.external_uri,
      'external_citation', v_node.external_citation,
      'verse_id', v_node.verse_id,
      'word_id', v_node.word_id,
      'word_position', v_node.word_position,
      'lemma_id', v_node.lemma_id,
      'concept_id', v_node.concept_id,
      'place_id', v_node.place_id,
      'event_id', v_node.event_id,
      'author', jsonb_build_object('id', v_node.author_id, 'kind', v_node.author_kind, 'display_name', v_node.author_display_name, 'ai_model', v_node.ai_model),
      'review_status', v_node.review_status,
      'visibility', v_node.visibility,
      'version', v_node.version
    ),
    'claims', v_claims,
    'linked_notes', v_linked_notes,
    'summary_counts', jsonb_build_object(
      'claims_shown', jsonb_array_length(v_claims),
      'potentially_stale', v_stale_count,
      'challenges_or_disputed', v_challenge_count,
      'linked_notes', jsonb_array_length(v_linked_notes)
    )
  );
END;
$$;

-- ============================================================================
-- 5. Read RPC: Bounded Hub-Controlled Neighborhood Expansion
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rg_expand_neighborhood_v1(
  p_node_ref text,
  p_direction text DEFAULT 'both',
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit integer DEFAULT 25,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
SET statement_timeout = '8s'
SET jit = 'off'
AS $$
DECLARE
  v_node_id uuid := public.rg_resolve_node_id_v1(p_node_ref);
  v_dir text := coalesce(nullif(p_direction, ''), 'both');
  v_f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 25);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_author_kind text := nullif(v_f->>'author_kind', '');
  v_ev_class text := nullif(v_f->>'evidence_class', '');
  v_rev_status text := nullif(v_f->>'review_status', '');
  v_predicate text := nullif(v_f->>'predicate', '');
  v_min_conf numeric := (v_f->>'min_confidence')::numeric;
  v_total_degree int := 0;
  v_edges jsonb := '[]'::jsonb;
BEGIN
  IF v_node_id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found', 'epistemic_layer', 'research_knowledge_graph', 'edges', '[]'::jsonb, 'total_degree', 0);
  END IF;

  WITH matching AS (
    SELECT
      c.id AS claim_id,
      c.claim_key,
      c.claim_kind,
      c.title,
      c.assertion_text,
      c.contextual_scope,
      c.limitations,
      c.predicate,
      ct.label AS predicate_label,
      ct.inverse_label AS predicate_inverse_label,
      ct.is_transitive,
      ct.is_symmetric,
      c.direction,
      CASE WHEN c.subject_node_id = v_node_id THEN 'outgoing' ELSE 'incoming' END AS traversal_dir,
      CASE WHEN c.subject_node_id = v_node_id THEN onode.id ELSE sn.id END AS neighbor_id,
      CASE WHEN c.subject_node_id = v_node_id THEN onode.node_key ELSE sn.node_key END AS neighbor_key,
      CASE WHEN c.subject_node_id = v_node_id THEN onode.label ELSE sn.label END AS neighbor_label,
      CASE WHEN c.subject_node_id = v_node_id THEN onode.node_kind ELSE sn.node_kind END AS neighbor_kind,
      CASE WHEN c.subject_node_id = v_node_id THEN onode.strongs_code ELSE sn.strongs_code END AS neighbor_strongs,
      CASE WHEN c.subject_node_id = v_node_id THEN onode.original_script ELSE sn.original_script END AS neighbor_script,
      c.origin_layer,
      c.evidence_class,
      c.epistemic_state,
      c.review_status,
      c.confidence,
      c.is_potentially_stale,
      na.display_name AS author_display_name,
      c.author_kind,
      na.ai_model,
      (SELECT count(DISTINCT e.source_key)::int FROM public.rg_claim_evidence e WHERE e.claim_id = c.id AND e.polarity = 'supporting' AND e.is_primary_source = true) AS independent_witness_count,
      (SELECT count(*)::int FROM public.rg_claim_links l WHERE l.to_claim_id = c.id AND l.link_type IN ('challenges', 'contradicts')) AS challenge_count,
      c.updated_at
    FROM public.rg_claims c
    JOIN public.note_connection_types ct ON ct.connection_type = c.predicate
    JOIN public.note_authors na ON na.id = c.author_id
    LEFT JOIN public.rg_nodes sn ON sn.id = c.subject_node_id
    LEFT JOIN public.rg_nodes onode ON onode.id = c.object_node_id
    WHERE c.status = 'published'
      AND c.review_status <> 'superseded'
      AND (
        (v_dir IN ('both', 'outgoing') AND c.subject_node_id = v_node_id AND c.object_node_id IS NOT NULL)
        OR (v_dir IN ('both', 'incoming') AND c.object_node_id = v_node_id AND c.subject_node_id IS NOT NULL)
      )
      AND (v_author_kind IS NULL OR c.author_kind = v_author_kind)
      AND (v_ev_class IS NULL OR c.evidence_class = v_ev_class)
      AND (v_rev_status IS NULL OR c.review_status = v_rev_status)
      AND (v_predicate IS NULL OR c.predicate = v_predicate)
      AND (v_min_conf IS NULL OR coalesce(c.confidence, 0) >= v_min_conf)
  )
  SELECT
    (SELECT count(*)::int FROM matching),
    COALESCE((
      SELECT jsonb_agg(row_to_json(m) ORDER BY (m.review_status = 'confirmed') DESC, m.independent_witness_count DESC, m.updated_at DESC)
      FROM (
        SELECT * FROM matching
        ORDER BY (review_status = 'confirmed') DESC, independent_witness_count DESC, updated_at DESC
        LIMIT v_limit OFFSET v_offset
      ) m
    ), '[]'::jsonb)
  INTO v_total_degree, v_edges;

  RETURN jsonb_build_object(
    'status', 'ok',
    'epistemic_layer', 'research_knowledge_graph',
    'untrusted_content_notice', 'Neighborhood edges reflect stored research assertions and must not be treated as canonical Scripture.',
    'center_node_id', v_node_id,
    'total_degree', v_total_degree,
    'hub_truncated', v_total_degree > (v_offset + jsonb_array_length(v_edges)),
    'edges', v_edges
  );
END;
$$;

-- ============================================================================
-- 6. Read RPC: Bounded, Cycle-Aware Multi-Entity Path Finder with Transitivity Check
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rg_find_paths_v1(
  p_from_refs text[],
  p_to_refs text[],
  p_max_hops integer DEFAULT 3,
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_limit integer DEFAULT 10
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
SET statement_timeout = '8s'
SET jit = 'off'
AS $$
DECLARE
  v_from_ids uuid[];
  v_to_ids uuid[];
  v_max_hops int := least(greatest(coalesce(p_max_hops, 3), 1), 4);
  v_limit int := least(greatest(coalesce(p_limit, 10), 1), 20);
  v_f jsonb := coalesce(p_filters, '{}'::jsonb);
  v_author_kind text := nullif(v_f->>'author_kind', '');
  v_ev_class text := nullif(v_f->>'evidence_class', '');
  v_rev_status text := nullif(v_f->>'review_status', '');
  v_paths jsonb := '[]'::jsonb;
BEGIN
  SELECT array_agg(DISTINCT nid) INTO v_from_ids
  FROM (SELECT public.rg_resolve_node_id_v1(r) AS nid FROM unnest(coalesce(p_from_refs, '{}'::text[])) r) x
  WHERE nid IS NOT NULL;

  SELECT array_agg(DISTINCT nid) INTO v_to_ids
  FROM (SELECT public.rg_resolve_node_id_v1(r) AS nid FROM unnest(coalesce(p_to_refs, '{}'::text[])) r) x
  WHERE nid IS NOT NULL;

  IF v_from_ids IS NULL OR v_to_ids IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'unresolved_endpoints',
      'epistemic_layer', 'research_knowledge_graph',
      'paths', '[]'::jsonb
    );
  END IF;

  WITH RECURSIVE active_edges AS (
    SELECT
      c.id AS claim_id,
      c.subject_node_id AS src,
      c.object_node_id AS dst,
      c.predicate,
      ct.label AS predicate_label,
      ct.is_transitive,
      ct.is_symmetric,
      c.evidence_class,
      c.review_status,
      c.origin_layer,
      c.author_kind,
      c.title,
      c.is_potentially_stale,
      'forward'::text AS step_dir
    FROM public.rg_claims c
    JOIN public.note_connection_types ct ON ct.connection_type = c.predicate
    WHERE c.status = 'published'
      AND c.review_status NOT IN ('rejected', 'superseded')
      AND c.subject_node_id IS NOT NULL
      AND c.object_node_id IS NOT NULL
      AND (v_author_kind IS NULL OR c.author_kind = v_author_kind)
      AND (v_ev_class IS NULL OR c.evidence_class = v_ev_class)
      AND (v_rev_status IS NULL OR c.review_status = v_rev_status)
    UNION ALL
    SELECT
      c.id AS claim_id,
      c.object_node_id AS src,
      c.subject_node_id AS dst,
      c.predicate,
      coalesce(ct.inverse_label, ct.label) AS predicate_label,
      ct.is_transitive,
      ct.is_symmetric,
      c.evidence_class,
      c.review_status,
      c.origin_layer,
      c.author_kind,
      c.title,
      c.is_potentially_stale,
      'reverse'::text AS step_dir
    FROM public.rg_claims c
    JOIN public.note_connection_types ct ON ct.connection_type = c.predicate
    WHERE c.status = 'published'
      AND c.review_status NOT IN ('rejected', 'superseded')
      AND c.subject_node_id IS NOT NULL
      AND c.object_node_id IS NOT NULL
      AND (c.direction IN ('bidirectional', 'undirected') OR ct.is_symmetric OR ct.inverse_type_key IS NOT NULL)
      AND (v_author_kind IS NULL OR c.author_kind = v_author_kind)
      AND (v_ev_class IS NULL OR c.evidence_class = v_ev_class)
      AND (v_rev_status IS NULL OR c.review_status = v_rev_status)
  ),
  walk(curr_node, visited_nodes, steps_json, hop_count, all_transitive, all_strong_ev, non_trans_preds) AS (
    SELECT
      ae.dst,
      ARRAY[ae.src, ae.dst],
      jsonb_build_array(jsonb_build_object(
        'claim_id', ae.claim_id,
        'from_node_id', ae.src,
        'to_node_id', ae.dst,
        'predicate', ae.predicate,
        'predicate_label', ae.predicate_label,
        'step_direction', ae.step_dir,
        'is_transitive', ae.is_transitive,
        'evidence_class', ae.evidence_class,
        'review_status', ae.review_status,
        'origin_layer', ae.origin_layer,
        'author_kind', ae.author_kind,
        'title', ae.title,
        'is_potentially_stale', ae.is_potentially_stale
      )),
      1,
      ae.is_transitive,
      (ae.evidence_class IN ('TEXT_EXPLICIT', 'TEXT_LINGUISTIC', 'TEXT_INTERTEXTUAL', 'SCIENCE_EMPIRICAL')),
      CASE WHEN ae.is_transitive THEN '{}'::text[] ELSE ARRAY[ae.predicate] END
    FROM active_edges ae
    WHERE ae.src = ANY(v_from_ids)

    UNION ALL

    SELECT
      nxt.dst,
      w.visited_nodes || nxt.dst,
      w.steps_json || jsonb_build_array(jsonb_build_object(
        'claim_id', nxt.claim_id,
        'from_node_id', nxt.src,
        'to_node_id', nxt.dst,
        'predicate', nxt.predicate,
        'predicate_label', nxt.predicate_label,
        'step_direction', nxt.step_dir,
        'is_transitive', nxt.is_transitive,
        'evidence_class', nxt.evidence_class,
        'review_status', nxt.review_status,
        'origin_layer', nxt.origin_layer,
        'author_kind', nxt.author_kind,
        'title', nxt.title,
        'is_potentially_stale', nxt.is_potentially_stale
      )),
      w.hop_count + 1,
      w.all_transitive AND nxt.is_transitive,
      w.all_strong_ev AND (nxt.evidence_class IN ('TEXT_EXPLICIT', 'TEXT_LINGUISTIC', 'TEXT_INTERTEXTUAL', 'SCIENCE_EMPIRICAL')),
      CASE WHEN nxt.is_transitive THEN w.non_trans_preds ELSE w.non_trans_preds || nxt.predicate END
    FROM walk w
    JOIN LATERAL (
      SELECT * FROM active_edges ae
      WHERE ae.src = w.curr_node
        AND NOT (ae.dst = ANY(w.visited_nodes))
      ORDER BY (ae.review_status = 'confirmed') DESC, ae.is_transitive DESC
      LIMIT 25
    ) nxt ON true
    WHERE w.hop_count < v_max_hops
      AND NOT (w.curr_node = ANY(v_to_ids))
  ),
  found AS (
    SELECT
      w.visited_nodes,
      w.steps_json,
      w.hop_count,
      (w.hop_count = 1 OR (w.all_transitive AND w.all_strong_ev)) AS is_validated_inference,
      w.non_trans_preds
    FROM walk w
    WHERE w.curr_node = ANY(v_to_ids)
    ORDER BY (w.hop_count = 1 OR (w.all_transitive AND w.all_strong_ev)) DESC, w.hop_count ASC
    LIMIT v_limit
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'hop_count', f.hop_count,
      'path_classification', CASE WHEN f.is_validated_inference THEN 'validated_inference_path' ELSE 'exploratory_path' END,
      'transitivity_valid', (f.hop_count = 1 OR array_length(f.non_trans_preds, 1) IS NULL),
      'transitivity_warning', CASE
        WHEN f.hop_count > 1 AND array_length(f.non_trans_preds, 1) IS NOT NULL
        THEN 'Contains non-transitive predicate(s) (' || array_to_string(f.non_trans_preds, ', ') || '); multi-hop traversal does NOT establish direct endpoint equivalence.'
        ELSE NULL END,
      'node_ids', f.visited_nodes,
      'steps', f.steps_json
    )
  ), '[]'::jsonb)
  INTO v_paths
  FROM found f;

  RETURN jsonb_build_object(
    'status', 'ok',
    'epistemic_layer', 'research_knowledge_graph',
    'untrusted_content_notice', 'Paths through the Research Knowledge Graph are research traversals; check transitivity_warning and primary evidence before inferring equivalence.',
    'from_node_ids', v_from_ids,
    'to_node_ids', v_to_ids,
    'paths', v_paths
  );
END;
$$;

-- ============================================================================
-- 7. Read RPC: Recursive Evidence Trace & Anti-Echo-Chamber Detector
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rg_trace_evidence_v1(
  p_claim_id uuid,
  p_max_depth integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
SET statement_timeout = '8s'
SET jit = 'off'
AS $$
DECLARE
  v_depth int := least(greatest(coalesce(p_max_depth, 5), 1), 6);
  v_root record;
  v_upstream jsonb := '[]'::jsonb;
  v_primary jsonb := '[]'::jsonb;
  v_shared_warnings jsonb := '[]'::jsonb;
  v_challenges jsonb := '[]'::jsonb;
  v_counterexamples jsonb := '[]'::jsonb;
  v_stale_deps jsonb := '[]'::jsonb;
  v_indep_count int := 0;
  v_cycle boolean := false;
BEGIN
  SELECT c.id, c.title, c.assertion_text, c.evidence_class, c.epistemic_state, c.review_status,
         c.is_potentially_stale, c.stale_reason, c.author_kind, na.display_name AS author_display_name
  INTO v_root
  FROM public.rg_claims c
  JOIN public.note_authors na ON na.id = c.author_id
  WHERE c.id = p_claim_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found', 'epistemic_layer', 'research_knowledge_graph');
  END IF;

  WITH RECURSIVE tree(claim_id, depth, path_ids, link_type, is_cycle) AS (
    SELECT p_claim_id, 0, ARRAY[p_claim_id], 'root'::text, false
    UNION ALL
    SELECT
      nxt.upstream_id,
      t.depth + 1,
      t.path_ids || nxt.upstream_id,
      nxt.link_type,
      (nxt.upstream_id = ANY(t.path_ids))
    FROM tree t
    JOIN LATERAL (
      SELECT l.to_claim_id AS upstream_id, l.link_type
      FROM public.rg_claim_links l
      WHERE l.from_claim_id = t.claim_id AND l.link_type IN ('depends_on', 'supports', 'refines')
      UNION
      SELECT e.target_claim_id AS upstream_id, 'evidence_claim'::text AS link_type
      FROM public.rg_claim_evidence e
      WHERE e.claim_id = t.claim_id AND e.target_claim_id IS NOT NULL AND e.polarity = 'supporting'
    ) nxt ON true
    WHERE NOT t.is_cycle AND t.depth < v_depth
  ),
  dedup_claims AS (
    SELECT DISTINCT ON (c.id)
      c.id, c.claim_key, c.title, c.evidence_class, c.epistemic_state, c.review_status,
      c.is_potentially_stale, c.stale_reason, c.author_kind, t.depth, t.link_type
    FROM tree t
    JOIN public.rg_claims c ON c.id = t.claim_id
    WHERE NOT t.is_cycle
    ORDER BY c.id, t.depth ASC
  ),
  ev_rows AS (
    SELECT
      e.*,
      dc.title AS claim_title,
      dc.depth AS claim_depth
    FROM dedup_claims dc
    JOIN public.rg_claim_evidence e ON e.claim_id = dc.id
  ),
  primary_grouped AS (
    SELECT
      source_key,
      min(evidence_kind) AS evidence_kind,
      max(verse_id) AS verse_id,
      max(word_id) AS word_id,
      max(lemma_id) AS lemma_id,
      max(external_url) AS external_url,
      max(external_title) AS external_title,
      count(DISTINCT claim_id)::int AS citing_claim_count,
      array_agg(DISTINCT claim_id) AS citing_claim_ids
    FROM ev_rows
    WHERE polarity = 'supporting' AND is_primary_source = true
    GROUP BY source_key
  )
  SELECT
    EXISTS (SELECT 1 FROM tree WHERE is_cycle),
    COALESCE((SELECT jsonb_agg(row_to_json(dc) ORDER BY dc.depth, dc.id) FROM dedup_claims dc WHERE dc.depth > 0), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(row_to_json(pg) ORDER BY pg.citing_claim_count DESC, pg.source_key) FROM primary_grouped pg), '[]'::jsonb),
    (SELECT count(*)::int FROM primary_grouped),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'source_key', pg.source_key,
        'citing_claim_count', pg.citing_claim_count,
        'warning', 'Multiple claims in this dependency chain share upstream witness ' || pg.source_key || '; do not count them as independent confirmations.'
      ))
      FROM primary_grouped pg WHERE pg.citing_claim_count >= 2
    ), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object('claim_id', dc.id, 'title', dc.title, 'stale_reason', dc.stale_reason, 'review_status', dc.review_status))
      FROM dedup_claims dc WHERE dc.is_potentially_stale OR dc.review_status IN ('disputed', 'rejected', 'superseded')), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'evidence_id', er.id, 'claim_id', er.claim_id, 'polarity', er.polarity,
      'source_key', er.source_key, 'explanation', er.explanation, 'external_url', er.external_url
    )) FROM ev_rows er WHERE er.polarity IN ('counterexample', 'control', 'limiting_case')), '[]'::jsonb)
  INTO v_cycle, v_upstream, v_primary, v_indep_count, v_shared_warnings, v_stale_deps, v_counterexamples;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'challenge_claim_id', ch.id,
    'link_type', l.link_type,
    'title', ch.title,
    'assertion_text', ch.assertion_text,
    'explanation', l.explanation,
    'review_status', ch.review_status,
    'author_kind', ch.author_kind
  )), '[]'::jsonb)
  INTO v_challenges
  FROM public.rg_claim_links l
  JOIN public.rg_claims ch ON ch.id = l.from_claim_id
  WHERE l.to_claim_id = p_claim_id
    AND l.link_type IN ('challenges', 'contradicts')
    AND ch.status = 'published';

  RETURN jsonb_build_object(
    'status', 'ok',
    'epistemic_layer', 'research_knowledge_graph',
    'untrusted_content_notice', 'Verify primary biblical and external witnesses directly before accepting downstream syntheses.',
    'claim', row_to_json(v_root),
    'independent_primary_witness_count', v_indep_count,
    'primary_witnesses', v_primary,
    'shared_upstream_warnings', v_shared_warnings,
    'upstream_claims', v_upstream,
    'challenges', v_challenges,
    'counterexamples', v_counterexamples,
    'stale_or_disputed_dependencies', v_stale_deps,
    'circular_dependency_detected', v_cycle
  );
END;
$$;

-- ============================================================================
-- 8. Read RPC: Contradictions, Competing Claims, Counterexamples & Stale Items
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rg_find_contradictions_v1(
  p_node_ref text DEFAULT NULL,
  p_claim_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
SET statement_timeout = '8s'
SET jit = 'off'
AS $$
DECLARE
  v_node_id uuid := CASE WHEN p_node_ref IS NOT NULL THEN public.rg_resolve_node_id_v1(p_node_ref) ELSE NULL END;
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 50);
  v_challenges jsonb := '[]'::jsonb;
  v_disputed_or_stale jsonb := '[]'::jsonb;
  v_competing jsonb := '[]'::jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(x)), '[]'::jsonb)
  INTO v_challenges
  FROM (
    SELECT
      l.id AS link_id, l.link_type, l.explanation,
      fc.id AS challenger_id, fc.title AS challenger_title, fc.assertion_text AS challenger_assertion, fc.author_kind AS challenger_author_kind,
      tc.id AS target_id, tc.title AS target_title, tc.assertion_text AS target_assertion, tc.review_status AS target_review_status
    FROM public.rg_claim_links l
    JOIN public.rg_claims fc ON fc.id = l.from_claim_id
    JOIN public.rg_claims tc ON tc.id = l.to_claim_id
    WHERE l.link_type IN ('challenges', 'contradicts')
      AND fc.status = 'published' AND tc.status = 'published'
      AND (p_claim_id IS NULL OR l.to_claim_id = p_claim_id OR l.from_claim_id = p_claim_id)
      AND (v_node_id IS NULL OR fc.subject_node_id = v_node_id OR fc.object_node_id = v_node_id OR tc.subject_node_id = v_node_id OR tc.object_node_id = v_node_id)
    ORDER BY l.created_at DESC
    LIMIT v_limit
  ) x;

  SELECT COALESCE(jsonb_agg(row_to_json(d)), '[]'::jsonb)
  INTO v_disputed_or_stale
  FROM (
    SELECT
      c.id, c.claim_key, c.title, c.assertion_text, c.claim_kind, c.evidence_class,
      c.review_status, c.epistemic_state, c.is_potentially_stale, c.stale_reason,
      c.unresolved_questions, c.author_kind, c.updated_at
    FROM public.rg_claims c
    WHERE c.status = 'published'
      AND (
        c.review_status = 'disputed'
        OR c.is_potentially_stale = true
        OR c.claim_kind IN ('challenge_critique', 'unresolved_question')
        OR array_length(c.unresolved_questions, 1) > 0
      )
      AND (p_claim_id IS NULL OR c.id = p_claim_id)
      AND (v_node_id IS NULL OR c.subject_node_id = v_node_id OR c.object_node_id = v_node_id)
    ORDER BY c.is_potentially_stale DESC, (c.review_status = 'disputed') DESC, c.updated_at DESC
    LIMIT v_limit
  ) d;

  SELECT COALESCE(jsonb_agg(row_to_json(cp)), '[]'::jsonb)
  INTO v_competing
  FROM (
    SELECT
      c1.subject_node_id,
      sn.label AS subject_label,
      c1.predicate,
      c1.id AS claim_a_id, c1.title AS claim_a_title, on1.label AS object_a_label,
      c2.id AS claim_b_id, c2.title AS claim_b_title, on2.label AS object_b_label
    FROM public.rg_claims c1
    JOIN public.rg_claims c2
      ON c1.subject_node_id = c2.subject_node_id
     AND c1.predicate = c2.predicate
     AND c1.id < c2.id
     AND c1.object_node_id IS DISTINCT FROM c2.object_node_id
    LEFT JOIN public.rg_nodes sn ON sn.id = c1.subject_node_id
    LEFT JOIN public.rg_nodes on1 ON on1.id = c1.object_node_id
    LEFT JOIN public.rg_nodes on2 ON on2.id = c2.object_node_id
    WHERE c1.status = 'published' AND c2.status = 'published'
      AND c1.review_status NOT IN ('rejected', 'superseded')
      AND c2.review_status NOT IN ('rejected', 'superseded')
      AND (v_node_id IS NULL OR c1.subject_node_id = v_node_id OR c1.object_node_id = v_node_id OR c2.object_node_id = v_node_id)
      AND (p_claim_id IS NULL OR c1.id = p_claim_id OR c2.id = p_claim_id)
    LIMIT v_limit
  ) cp;

  RETURN jsonb_build_object(
    'status', 'ok',
    'epistemic_layer', 'research_knowledge_graph',
    'challenges', v_challenges,
    'disputed_stale_or_open', v_disputed_or_stale,
    'competing_claims', v_competing
  );
END;
$$;

-- ============================================================================
-- 9. Read RPCs: Durable Research Trails
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rg_list_trails_v1(
  p_status text DEFAULT NULL,
  p_query text DEFAULT NULL,
  p_limit integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
SET statement_timeout = '8s'
AS $$
DECLARE
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_q text := nullif(btrim(coalesce(p_query, '')), '');
  v_items jsonb := '[]'::jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      tr.id, tr.trail_key, tr.title, tr.research_question, tr.status,
      jsonb_array_length(tr.frontier) AS open_frontier_count,
      jsonb_array_length(tr.checkpoints) AS checkpoint_count,
      tr.author_kind, na.display_name AS author_display_name, na.ai_model,
      tr.visibility, tr.version, tr.updated_at
    FROM public.rg_research_trails tr
    JOIN public.note_authors na ON na.id = tr.author_id
    WHERE (p_status IS NULL OR tr.status = p_status)
      AND (v_q IS NULL OR tr.title ILIKE '%' || v_q || '%' OR tr.research_question ILIKE '%' || v_q || '%' OR tr.trail_key ILIKE '%' || v_q || '%')
    ORDER BY tr.updated_at DESC
    LIMIT v_limit
  ) t;

  RETURN jsonb_build_object(
    'status', 'ok',
    'epistemic_layer', 'research_knowledge_graph',
    'trails', v_items
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rg_get_trail_v1(p_trail_ref text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
SET statement_timeout = '8s'
AS $$
DECLARE
  v_trim text := nullif(btrim(coalesce(p_trail_ref, '')), '');
  v_row jsonb;
BEGIN
  IF v_trim IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found', 'trail', NULL);
  END IF;

  SELECT row_to_json(t)::jsonb INTO v_row
  FROM (
    SELECT tr.*, na.display_name AS author_display_name, na.ai_model
    FROM public.rg_research_trails tr
    JOIN public.note_authors na ON na.id = tr.author_id
    WHERE (v_trim ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND tr.id = v_trim::uuid)
       OR tr.trail_key = v_trim
    LIMIT 1
  ) t;

  IF v_row IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found', 'trail', NULL);
  END IF;
  RETURN jsonb_build_object('status', 'ok', 'epistemic_layer', 'research_knowledge_graph', 'trail', v_row);
END;
$$;

-- ============================================================================
-- 10. Internal Helper: Staleness Propagation & Revision Snapshots
-- ============================================================================
CREATE OR REPLACE FUNCTION bible_internal.rg_propagate_staleness_v1(
  p_root_claim_id uuid,
  p_reason text
)
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_updated int := 0;
BEGIN
  WITH RECURSIVE downstream(cid, depth) AS (
    SELECT l.from_claim_id, 1
    FROM public.rg_claim_links l
    WHERE l.to_claim_id = p_root_claim_id
      AND l.link_type IN ('depends_on', 'supports', 'refines')
    UNION
    SELECT e.claim_id, 1
    FROM public.rg_claim_evidence e
    WHERE e.target_claim_id = p_root_claim_id AND e.polarity = 'supporting'
    UNION ALL
    SELECT l2.from_claim_id, d.depth + 1
    FROM downstream d
    JOIN public.rg_claim_links l2 ON l2.to_claim_id = d.cid
    WHERE l2.link_type IN ('depends_on', 'supports', 'refines') AND d.depth < 6
  )
  UPDATE public.rg_claims c
  SET
    is_potentially_stale = true,
    stale_reason = left(coalesce(p_reason, 'Upstream dependency changed'), 500),
    stale_since = coalesce(c.stale_since, now())
  FROM downstream d
  WHERE c.id = d.cid
    AND c.id <> p_root_claim_id
    AND c.status = 'published'
    AND c.review_status <> 'superseded';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

-- ============================================================================
-- 11. Internal Shared Transactional Batch Writer (Human UI & Agent MCP parity)
-- ============================================================================
CREATE OR REPLACE FUNCTION bible_internal.rg_apply_batch_v1(
  p_author_id uuid,
  p_author_kind text,
  p_created_via text,
  p_owner_user_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_nodes jsonb := coalesce(p_payload->'nodes', '[]'::jsonb);
  v_claims jsonb := coalesce(p_payload->'claims', '[]'::jsonb);
  v_links jsonb := coalesce(p_payload->'links', '[]'::jsonb);
  v_node_map jsonb := '{}'::jsonb;
  v_claim_map jsonb := '{}'::jsonb;
  v_saved_nodes jsonb := '[]'::jsonb;
  v_saved_claims jsonb := '[]'::jsonb;
  v_saved_links jsonb := '[]'::jsonb;
  v_stale_total int := 0;
  v_elem jsonb;
  v_ev jsonb;
  v_part jsonb;
  v_ckey text;
  v_nkey text;
  v_nid uuid;
  v_cid uuid;
  v_existing_cid uuid;
  v_curr_author uuid;
  v_curr_ver int;
  v_exp_ver int;
  v_new_ver int;
  v_vis text;
  v_subj_id uuid;
  v_obj_id uuid;
  v_pred text;
  v_ev_class text;
  v_ckind text;
  v_ep_state text;
  v_rev_status text;
  v_client_req text;
  v_chash text;
  v_dup_cid uuid;
  v_has_scripture_ev boolean;
  v_has_https_ev boolean;
  v_from_cid uuid;
  v_to_cid uuid;
  v_link_id uuid;
  v_p_idx int;
  v_pnode uuid;
  v_src_key text;
  v_verse_id int;
  v_word_id int;
  v_word_pos int;
  v_lemma_id bigint;
  v_target_cid uuid;
  v_ext_url text;
  v_ext_title text;
  v_verse_wids int[];
BEGIN
  IF jsonb_typeof(v_nodes) <> 'array' OR jsonb_typeof(v_claims) <> 'array' OR jsonb_typeof(v_links) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'validation_failed', 'message', 'nodes, claims, and links must be JSON arrays'));
  END IF;
  IF jsonb_array_length(v_nodes) > 30 OR jsonb_array_length(v_claims) > 25 OR jsonb_array_length(v_links) > 40 THEN
    RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'payload_too_large', 'message', 'Batch limit exceeded (max 30 nodes, 25 claims, 40 links)'));
  END IF;

  -- A. Upsert / Resolve Nodes
  FOR v_elem IN SELECT * FROM jsonb_array_elements(v_nodes) LOOP
    v_ckey := nullif(btrim(coalesce(v_elem->>'client_key', '')), '');
    v_nkey := nullif(btrim(coalesce(v_elem->>'node_key', '')), '');
    v_vis := coalesce(nullif(v_elem->>'visibility', ''), 'public');
    IF v_vis NOT IN ('public', 'private') THEN
      RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'validation_failed', 'message', 'Invalid node visibility'));
    END IF;
    IF v_vis = 'private' AND p_owner_user_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'auth_required', 'message', 'Private research nodes require an authenticated session'));
    END IF;

    IF v_nkey IS NULL THEN
      v_nkey := 'rg:' || coalesce(v_elem->>'node_kind', 'concept') || ':' || encode(extensions.gen_random_bytes(6), 'hex');
    END IF;

    SELECT id INTO v_nid FROM public.rg_nodes WHERE node_key = v_nkey;
    IF v_nid IS NULL THEN
      v_nid := gen_random_uuid();
      INSERT INTO public.rg_nodes (
        id, node_key, node_kind, origin_layer,
        canonical_entity_id, verse_id, end_verse_id, word_id, word_position,
        lemma_id, sense_id, root_id, place_id, event_id, concept_id, note_id,
        source_edition, source_release, label, original_script, transliteration, strongs_code,
        aliases, summary, definitions, polarity_notes, disambiguation_note,
        external_uri, external_citation, metadata,
        author_id, author_kind, owner_user_id, visibility, status, review_status
      ) VALUES (
        v_nid, v_nkey, v_elem->>'node_kind',
        coalesce(nullif(v_elem->>'origin_layer', ''), CASE WHEN p_author_kind = 'ai' THEN 'ai_research' ELSE 'human_research' END),
        (v_elem->>'canonical_entity_id')::bigint,
        (v_elem->>'verse_id')::int,
        (v_elem->>'end_verse_id')::int,
        (v_elem->>'word_id')::int,
        (v_elem->>'word_position')::int,
        (v_elem->>'lemma_id')::bigint,
        (v_elem->>'sense_id')::bigint,
        (v_elem->>'root_id')::bigint,
        (v_elem->>'place_id')::bigint,
        (v_elem->>'event_id')::bigint,
        (v_elem->>'concept_id')::bigint,
        (v_elem->>'note_id')::uuid,
        v_elem->>'source_edition',
        v_elem->>'source_release',
        btrim(v_elem->>'label'),
        v_elem->>'original_script',
        v_elem->>'transliteration',
        v_elem->>'strongs_code',
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_elem->'aliases')), '{}'::text[]),
        coalesce(v_elem->>'summary', ''),
        coalesce(v_elem->'definitions', '{}'::jsonb),
        v_elem->>'polarity_notes',
        v_elem->>'disambiguation_note',
        v_elem->>'external_uri',
        coalesce(v_elem->'external_citation', '{}'::jsonb),
        coalesce(v_elem->'metadata', '{}'::jsonb),
        p_author_id, p_author_kind,
        CASE WHEN v_vis = 'private' THEN p_owner_user_id ELSE NULL END,
        v_vis, 'active', 'unreviewed'
      );
    ELSE
      -- Reuse existing node if public/owned; only owner/same author updates mutable summary/aliases when explicitly requested
      IF coalesce((v_elem->>'update_if_exists')::boolean, false) THEN
        UPDATE public.rg_nodes SET
          summary = CASE WHEN v_elem ? 'summary' THEN coalesce(v_elem->>'summary', summary) ELSE summary END,
          disambiguation_note = CASE WHEN v_elem ? 'disambiguation_note' THEN v_elem->>'disambiguation_note' ELSE disambiguation_note END,
          polarity_notes = CASE WHEN v_elem ? 'polarity_notes' THEN v_elem->>'polarity_notes' ELSE polarity_notes END,
          definitions = CASE WHEN v_elem ? 'definitions' THEN definitions || coalesce(v_elem->'definitions', '{}'::jsonb) ELSE definitions END,
          version = version + 1
        WHERE id = v_nid AND author_id = p_author_id;
      END IF;
    END IF;

    IF v_ckey IS NOT NULL THEN
      v_node_map := jsonb_set(v_node_map, ARRAY[v_ckey], to_jsonb(v_nid::text));
    END IF;
    v_node_map := jsonb_set(v_node_map, ARRAY[v_nkey], to_jsonb(v_nid::text));
    v_saved_nodes := v_saved_nodes || jsonb_build_array(jsonb_build_object('id', v_nid, 'node_key', v_nkey, 'label', v_elem->>'label'));
  END LOOP;

  -- B. Create / Update Claims
  FOR v_elem IN SELECT * FROM jsonb_array_elements(v_claims) LOOP
    v_ckey := nullif(btrim(coalesce(v_elem->>'client_key', '')), '');
    v_client_req := nullif(btrim(coalesce(v_elem->>'client_request_id', '')), '');
    v_ckind := v_elem->>'claim_kind';
    v_ev_class := v_elem->>'evidence_class';
    v_pred := v_elem->>'predicate';
    v_vis := coalesce(nullif(v_elem->>'visibility', ''), 'public');

    IF v_vis NOT IN ('public', 'private') THEN
      RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'validation_failed', 'message', 'Invalid claim visibility'));
    END IF;
    IF v_vis = 'private' AND p_owner_user_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'auth_required', 'message', 'Private claims require an authenticated session'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.note_connection_types WHERE connection_type = v_pred) THEN
      RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'validation_failed', 'message', 'Invalid predicate: ' || coalesce(v_pred, 'null'), 'field', 'predicate'));
    END IF;

    -- Resolve subject & object nodes (via client_key map, UUID, node_key, Strong's, or label)
    v_subj_id := NULL;
    IF nullif(v_elem->>'subject_ref', '') IS NOT NULL THEN
      IF v_node_map ? (v_elem->>'subject_ref') THEN
        v_subj_id := (v_node_map->>(v_elem->>'subject_ref'))::uuid;
      ELSE
        v_subj_id := public.rg_resolve_node_id_v1(v_elem->>'subject_ref');
      END IF;
      IF v_subj_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'node_not_found', 'message', 'Unresolved subject_ref: ' || (v_elem->>'subject_ref')));
      END IF;
    END IF;

    v_obj_id := NULL;
    IF nullif(v_elem->>'object_ref', '') IS NOT NULL THEN
      IF v_node_map ? (v_elem->>'object_ref') THEN
        v_obj_id := (v_node_map->>(v_elem->>'object_ref'))::uuid;
      ELSE
        v_obj_id := public.rg_resolve_node_id_v1(v_elem->>'object_ref');
      END IF;
      IF v_obj_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'node_not_found', 'message', 'Unresolved object_ref: ' || (v_elem->>'object_ref')));
      END IF;
    END IF;

    -- Epistemic partition validation on evidence array
    v_has_scripture_ev := false;
    v_has_https_ev := false;
    FOR v_ev IN SELECT * FROM jsonb_array_elements(coalesce(v_elem->'evidence', '[]'::jsonb)) LOOP
      IF (v_ev->>'evidence_kind') IN ('scripture_verse', 'word_occurrence', 'lemma') THEN
        IF (v_ev->>'verse_id') IS NOT NULL OR (v_ev->>'word_id') IS NOT NULL OR (v_ev->>'lemma_id') IS NOT NULL THEN
          v_has_scripture_ev := true;
        END IF;
      END IF;
      IF (v_ev->>'evidence_kind') = 'external_source'
         AND char_length(coalesce(v_ev->>'external_url', '')) <= 500
         AND nullif(v_ev->>'external_url', '') ~* '^https://[^[:space:]<>"]{4,}$'
         AND char_length(btrim(coalesce(v_ev->>'external_title', ''))) >= 3 THEN
        v_has_https_ev := true;
      END IF;
    END LOOP;

    IF v_ev_class = 'SCIENCE_EMPIRICAL' AND NOT v_has_https_ev THEN
      RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'invalid_evidence_partition', 'message', 'SCIENCE_EMPIRICAL claims require at least one external_source evidence item with HTTPS external_url and external_title.'));
    END IF;
    IF v_ev_class = 'TEXT_EXPLICIT' AND NOT v_has_scripture_ev THEN
      RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'invalid_evidence_partition', 'message', 'TEXT_EXPLICIT claims require at least one biblical verse, word occurrence, or lemma evidence anchor.'));
    END IF;

    v_ep_state := coalesce(nullif(v_elem->>'epistemic_state', ''), CASE
      WHEN v_ev_class = 'DLM_HYPOTHESIS' THEN 'plausible_hypothesis'
      WHEN v_ev_class IN ('TEXT_EXPLICIT', 'TEXT_LINGUISTIC', 'SCIENCE_EMPIRICAL') THEN 'established_observation'
      WHEN v_ev_class = 'DISPUTED' THEN 'disputed'
      WHEN v_ev_class = 'OPEN' THEN 'open'
      ELSE 'well_supported_interpretation'
    END);

    -- AI cannot self-confirm; always starts unreviewed
    v_rev_status := CASE WHEN p_author_kind = 'ai' THEN 'unreviewed' ELSE coalesce(nullif(v_elem->>'review_status', ''), 'unreviewed') END;

    -- Idempotency via client_request_id
    IF v_client_req IS NOT NULL THEN
      SELECT id INTO v_existing_cid FROM public.rg_claims WHERE author_id = p_author_id AND client_request_id = v_client_req;
      IF v_existing_cid IS NOT NULL THEN
        IF v_ckey IS NOT NULL THEN v_claim_map := jsonb_set(v_claim_map, ARRAY[v_ckey], to_jsonb(v_existing_cid::text)); END IF;
        v_saved_claims := v_saved_claims || jsonb_build_array(jsonb_build_object('id', v_existing_cid, 'created', false, 'idempotent', true));
        CONTINUE;
      END IF;
    END IF;

    v_chash := encode(extensions.digest(convert_to(
      coalesce(v_subj_id::text, '') || '|' || v_pred || '|' || coalesce(v_obj_id::text, '') || '|' || lower(btrim(coalesce(v_elem->>'assertion_text', ''))),
      'UTF8'
    ), 'sha256'), 'hex');

    IF nullif(v_elem->>'id', '') IS NOT NULL THEN
      -- Update existing claim
      v_cid := (v_elem->>'id')::uuid;
      SELECT author_id, version INTO v_curr_author, v_curr_ver FROM public.rg_claims WHERE id = v_cid FOR UPDATE;
      IF v_curr_author IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'not_found', 'message', 'Claim not found: ' || v_cid::text));
      END IF;
      IF p_author_kind = 'ai' AND v_curr_author <> p_author_id THEN
        RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'forbidden', 'message', 'AI agents may only update their own claims'));
      END IF;
      IF v_elem ? 'expected_version' AND v_elem->>'expected_version' IS NOT NULL THEN
        v_exp_ver := (v_elem->>'expected_version')::int;
        IF v_exp_ver <> v_curr_ver THEN
          RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'version_conflict', 'message', 'Expected version ' || v_exp_ver || ' but current is ' || v_curr_ver, 'current_version', v_curr_ver));
        END IF;
      END IF;
      v_new_ver := v_curr_ver + 1;

      UPDATE public.rg_claims SET
        claim_kind = v_ckind,
        subject_node_id = v_subj_id,
        predicate = v_pred,
        object_node_id = v_obj_id,
        direction = coalesce(nullif(v_elem->>'direction', ''), direction),
        title = btrim(v_elem->>'title'),
        assertion_text = btrim(v_elem->>'assertion_text'),
        explanation_md = coalesce(v_elem->>'explanation_md', explanation_md),
        contextual_scope = coalesce(v_elem->>'contextual_scope', contextual_scope),
        limitations = coalesce(v_elem->>'limitations', limitations),
        unresolved_questions = CASE WHEN v_elem ? 'unresolved_questions' THEN COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_elem->'unresolved_questions')), '{}'::text[]) ELSE unresolved_questions END,
        dlm_metadata = CASE WHEN v_elem ? 'dlm_metadata' THEN coalesce(v_elem->'dlm_metadata', '{}'::jsonb) ELSE dlm_metadata END,
        evidence_class = v_ev_class,
        epistemic_state = v_ep_state,
        review_status = CASE WHEN p_author_kind = 'ai' THEN 'unreviewed' ELSE v_rev_status END,
        confidence = (v_elem->>'confidence')::numeric,
        confidence_dimensions = CASE WHEN v_elem ? 'confidence_dimensions' THEN coalesce(v_elem->'confidence_dimensions', '{}'::jsonb) ELSE confidence_dimensions END,
        is_potentially_stale = false,
        stale_reason = NULL,
        stale_since = NULL,
        source_context = CASE WHEN v_elem ? 'source_context' THEN coalesce(v_elem->'source_context', '{}'::jsonb) ELSE source_context END,
        content_hash = v_chash,
        version = v_new_ver
      WHERE id = v_cid;

      DELETE FROM public.rg_claim_participants WHERE claim_id = v_cid;
      DELETE FROM public.rg_claim_evidence WHERE claim_id = v_cid;

      v_stale_total := v_stale_total + bible_internal.rg_propagate_staleness_v1(v_cid, 'Upstream claim updated to v' || v_new_ver::text);
    ELSE
      -- 24h duplicate suppression for identical hash by same author
      SELECT id INTO v_dup_cid
      FROM public.rg_claims
      WHERE author_id = p_author_id AND content_hash = v_chash AND status <> 'removed' AND created_at > (now() - interval '24 hours')
      ORDER BY created_at DESC LIMIT 1;

      IF v_dup_cid IS NOT NULL THEN
        IF v_ckey IS NOT NULL THEN v_claim_map := jsonb_set(v_claim_map, ARRAY[v_ckey], to_jsonb(v_dup_cid::text)); END IF;
        v_saved_claims := v_saved_claims || jsonb_build_array(jsonb_build_object('id', v_dup_cid, 'created', false, 'duplicate', true));
        CONTINUE;
      END IF;

      v_cid := gen_random_uuid();
      v_new_ver := 1;
      INSERT INTO public.rg_claims (
        id, claim_key, claim_kind, subject_node_id, predicate, object_node_id, direction,
        title, assertion_text, explanation_md, contextual_scope, limitations, unresolved_questions,
        dlm_metadata, origin_layer, evidence_class, epistemic_state, review_status,
        confidence, confidence_dimensions, supersedes_claim_id, source_note_id,
        author_id, author_kind, created_via, owner_user_id, visibility, status,
        version, client_request_id, content_hash, source_context
      ) VALUES (
        v_cid,
        coalesce(nullif(btrim(coalesce(v_elem->>'claim_key', '')), ''), 'claim:' || encode(extensions.gen_random_bytes(8), 'hex')),
        v_ckind, v_subj_id, v_pred, v_obj_id,
        coalesce(nullif(v_elem->>'direction', ''), 'directed'),
        btrim(v_elem->>'title'),
        btrim(v_elem->>'assertion_text'),
        coalesce(v_elem->>'explanation_md', ''),
        coalesce(v_elem->>'contextual_scope', ''),
        coalesce(v_elem->>'limitations', ''),
        COALESCE(ARRAY(SELECT jsonb_array_elements_text(v_elem->'unresolved_questions')), '{}'::text[]),
        coalesce(v_elem->'dlm_metadata', '{}'::jsonb),
        CASE WHEN p_author_kind = 'ai' THEN 'ai_research' ELSE 'human_research' END,
        v_ev_class, v_ep_state, v_rev_status,
        (v_elem->>'confidence')::numeric,
        coalesce(v_elem->'confidence_dimensions', '{}'::jsonb),
        (v_elem->>'supersedes_claim_id')::uuid,
        (v_elem->>'source_note_id')::uuid,
        p_author_id, p_author_kind, p_created_via,
        CASE WHEN v_vis = 'private' THEN p_owner_user_id ELSE NULL END,
        v_vis, 'published', 1, v_client_req, v_chash,
        coalesce(v_elem->'source_context', '{}'::jsonb)
      );

      IF nullif(v_elem->>'supersedes_claim_id', '') IS NOT NULL THEN
        INSERT INTO public.rg_claim_links (from_claim_id, to_claim_id, link_type, explanation, author_id, author_kind)
        VALUES (v_cid, (v_elem->>'supersedes_claim_id')::uuid, 'supersedes', 'Superseding claim created', p_author_id, p_author_kind)
        ON CONFLICT DO NOTHING;

        UPDATE public.rg_claims SET review_status = 'superseded'
        WHERE id = (v_elem->>'supersedes_claim_id')::uuid AND (p_author_kind = 'human' OR author_id = p_author_id);

        v_stale_total := v_stale_total + bible_internal.rg_propagate_staleness_v1(
          (v_elem->>'supersedes_claim_id')::uuid,
          'Superseded by claim ' || v_cid::text
        );
      END IF;
    END IF;

    -- Insert ordered participants
    v_p_idx := 0;
    FOR v_part IN SELECT * FROM jsonb_array_elements(coalesce(v_elem->'participants', '[]'::jsonb)) LOOP
      v_pnode := NULL;
      IF v_node_map ? (v_part->>'node_ref') THEN
        v_pnode := (v_node_map->>(v_part->>'node_ref'))::uuid;
      ELSE
        v_pnode := public.rg_resolve_node_id_v1(v_part->>'node_ref');
      END IF;
      IF v_pnode IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'node_not_found', 'message', 'Unresolved participant node_ref: ' || coalesce(v_part->>'node_ref', 'null')));
      END IF;
      INSERT INTO public.rg_claim_participants (claim_id, node_id, role, ordinal, slot_key, notes)
      VALUES (v_cid, v_pnode, v_part->>'role', coalesce((v_part->>'ordinal')::int, v_p_idx), v_part->>'slot_key', v_part->>'notes');
      v_p_idx := v_p_idx + 1;
    END LOOP;

    -- Insert evidence / counterevidence with occurrence validation when word_position is supplied
    FOR v_ev IN SELECT * FROM jsonb_array_elements(coalesce(v_elem->'evidence', '[]'::jsonb)) LOOP
      v_verse_id := (v_ev->>'verse_id')::int;
      v_word_id := (v_ev->>'word_id')::int;
      v_word_pos := (v_ev->>'word_position')::int;
      v_lemma_id := (v_ev->>'lemma_id')::bigint;
      v_target_cid := NULL;
      IF nullif(v_ev->>'target_claim_ref', '') IS NOT NULL THEN
        IF v_claim_map ? (v_ev->>'target_claim_ref') THEN
          v_target_cid := (v_claim_map->>(v_ev->>'target_claim_ref'))::uuid;
        ELSE
          v_target_cid := (v_ev->>'target_claim_ref')::uuid;
        END IF;
      ELSIF nullif(v_ev->>'target_claim_id', '') IS NOT NULL THEN
        v_target_cid := (v_ev->>'target_claim_id')::uuid;
      END IF;

      IF (v_ev->>'evidence_kind') = 'word_occurrence' AND v_verse_id IS NOT NULL AND v_word_pos IS NOT NULL AND v_word_id IS NOT NULL THEN
        SELECT word_ids INTO v_verse_wids FROM public.verses WHERE id = v_verse_id;
        IF v_verse_wids IS NULL OR v_word_pos < 1 OR v_word_pos > array_length(v_verse_wids, 1) OR v_verse_wids[v_word_pos] <> v_word_id THEN
          RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'anchor_invalid', 'message', 'word_id does not match canonical word_position in verse ' || v_verse_id::text));
        END IF;
      END IF;

      v_ext_url := nullif(v_ev->>'external_url', '');
      v_ext_title := nullif(v_ev->>'external_title', '');
      v_src_key := coalesce(
        nullif(btrim(coalesce(v_ev->>'source_key', '')), ''),
        CASE
          WHEN v_verse_id IS NOT NULL AND v_word_pos IS NOT NULL THEN 'occ:' || v_verse_id || ':' || v_word_pos
          WHEN v_verse_id IS NOT NULL THEN 'verse:' || v_verse_id
          WHEN v_lemma_id IS NOT NULL THEN 'lemma:' || v_lemma_id
          WHEN v_ext_url IS NOT NULL THEN 'url:' || lower(v_ext_url)
          WHEN nullif(v_ev->>'algorithm_evidence_id', '') IS NOT NULL THEN 'alg:' || (v_ev->>'algorithm_evidence_id')
          WHEN v_target_cid IS NOT NULL THEN 'claim:' || v_target_cid::text
          ELSE 'ref:' || encode(extensions.gen_random_bytes(4), 'hex')
        END
      );

      INSERT INTO public.rg_claim_evidence (
        claim_id, polarity, evidence_kind, source_key,
        node_id, verse_id, end_verse_id, word_id, word_position, lemma_id,
        target_claim_id, target_note_id, source_edition, source_release,
        algorithm_evidence_id, external_title, external_url, external_locator,
        citation_text, explanation, is_primary_source
      ) VALUES (
        v_cid,
        coalesce(nullif(v_ev->>'polarity', ''), 'supporting'),
        v_ev->>'evidence_kind',
        v_src_key,
        CASE WHEN nullif(v_ev->>'node_ref', '') IS NOT NULL THEN coalesce((v_node_map->>(v_ev->>'node_ref'))::uuid, public.rg_resolve_node_id_v1(v_ev->>'node_ref')) ELSE NULL END,
        v_verse_id, (v_ev->>'end_verse_id')::int, v_word_id, v_word_pos, v_lemma_id,
        v_target_cid, (v_ev->>'target_note_id')::uuid,
        v_ev->>'source_edition', v_ev->>'source_release',
        v_ev->>'algorithm_evidence_id', v_ext_title, v_ext_url, v_ev->>'external_locator',
        v_ev->>'citation_text', coalesce(v_ev->>'explanation', ''),
        coalesce((v_ev->>'is_primary_source')::boolean, (v_ev->>'evidence_kind') <> 'prior_claim')
      );
    END LOOP;

    -- Revision snapshot
    INSERT INTO public.rg_claim_revisions (claim_id, version, action, editor_author_id, editor_kind, snapshot)
    VALUES (
      v_cid, v_new_ver,
      CASE WHEN v_new_ver = 1 THEN 'create' ELSE 'update' END,
      p_author_id, p_author_kind,
      jsonb_build_object(
        'title', btrim(v_elem->>'title'),
        'assertion_text', btrim(v_elem->>'assertion_text'),
        'predicate', v_pred,
        'evidence_class', v_ev_class,
        'epistemic_state', v_ep_state,
        'review_status', v_rev_status
      )
    );

    IF v_ckey IS NOT NULL THEN
      v_claim_map := jsonb_set(v_claim_map, ARRAY[v_ckey], to_jsonb(v_cid::text));
    END IF;
    v_saved_claims := v_saved_claims || jsonb_build_array(jsonb_build_object('id', v_cid, 'version', v_new_ver, 'created', (v_new_ver = 1)));
  END LOOP;

  -- C. Create Claim-to-Claim Links
  FOR v_elem IN SELECT * FROM jsonb_array_elements(v_links) LOOP
    v_from_cid := coalesce((v_claim_map->>(v_elem->>'from_claim_ref'))::uuid, nullif(v_elem->>'from_claim_ref', '')::uuid);
    v_to_cid := coalesce((v_claim_map->>(v_elem->>'to_claim_ref'))::uuid, nullif(v_elem->>'to_claim_ref', '')::uuid);

    INSERT INTO public.rg_claim_links (from_claim_id, to_claim_id, link_type, explanation, author_id, author_kind)
    VALUES (v_from_cid, v_to_cid, v_elem->>'link_type', coalesce(v_elem->>'explanation', ''), p_author_id, p_author_kind)
    ON CONFLICT (from_claim_id, to_claim_id, link_type) DO UPDATE SET explanation = EXCLUDED.explanation
    RETURNING id INTO v_link_id;

    v_saved_links := v_saved_links || jsonb_build_array(jsonb_build_object('id', v_link_id, 'from_claim_id', v_from_cid, 'to_claim_id', v_to_cid, 'link_type', v_elem->>'link_type'));
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'nodes', v_saved_nodes,
    'claims', v_saved_claims,
    'links', v_saved_links,
    'downstream_marked_stale', v_stale_total
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'validation_failed', 'message', SQLERRM));
END;
$$;

-- ============================================================================
-- 12. Public Human Write & Review RPCs (SECURITY DEFINER, write-guarded)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rg_save_batch_v1(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $$
DECLARE
  v_settings record;
  v_author_id uuid := '00000000-0000-0000-0000-00000000a001'::uuid;
  v_hourly_count int;
  v_uid uuid := auth.uid();
BEGIN
  SELECT * INTO v_settings FROM public.note_settings WHERE id = true;
  IF v_settings IS NULL OR NOT coalesce(v_settings.human_writes_enabled, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'writes_disabled', 'message', 'Human writes are currently disabled in note_settings'));
  END IF;

  SELECT count(*)::int INTO v_hourly_count
  FROM public.rg_claim_revisions
  WHERE editor_author_id = v_author_id AND created_at > (now() - interval '1 hour');
  IF v_hourly_count >= coalesce(v_settings.human_writes_per_hour, 600) THEN
    RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'rate_limited', 'message', 'Human hourly write rate limit exceeded'));
  END IF;

  RETURN bible_internal.rg_apply_batch_v1(v_author_id, 'human', 'ui', v_uid, p_payload);
END;
$$;

CREATE OR REPLACE FUNCTION public.rg_review_claim_v1(
  p_claim_id uuid,
  p_review_status text,
  p_epistemic_state text DEFAULT NULL,
  p_review_note text DEFAULT NULL,
  p_clear_stale boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $$
DECLARE
  v_settings record;
  v_reviewer_id uuid := '00000000-0000-0000-0000-00000000a001'::uuid;
  v_curr record;
  v_new_ver int;
  v_stale_count int := 0;
BEGIN
  SELECT * INTO v_settings FROM public.note_settings WHERE id = true;
  IF v_settings IS NULL OR NOT coalesce(v_settings.human_writes_enabled, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'writes_disabled', 'message', 'Human writes/reviews are currently disabled'));
  END IF;
  IF p_review_status IS NULL OR p_review_status NOT IN ('unreviewed', 'confirmed', 'disputed', 'rejected', 'superseded') THEN
    RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'validation_failed', 'message', 'Invalid review_status'));
  END IF;

  SELECT * INTO v_curr FROM public.rg_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'not_found', 'message', 'Claim not found'));
  END IF;
  IF v_curr.visibility = 'private' AND (v_curr.owner_user_id IS NULL OR v_curr.owner_user_id IS DISTINCT FROM auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'forbidden', 'message', 'Cannot review another user private claim'));
  END IF;

  v_new_ver := v_curr.version + 1;
  -- Preserves original author_id, author_kind, and origin_layer
  UPDATE public.rg_claims SET
    review_status = p_review_status,
    epistemic_state = coalesce(nullif(p_epistemic_state, ''), epistemic_state),
    reviewed_by_author_id = v_reviewer_id,
    reviewed_at = now(),
    is_potentially_stale = CASE WHEN p_clear_stale THEN false ELSE is_potentially_stale END,
    stale_reason = CASE WHEN p_clear_stale THEN NULL ELSE stale_reason END,
    stale_since = CASE WHEN p_clear_stale THEN NULL ELSE stale_since END,
    version = v_new_ver
  WHERE id = p_claim_id;

  IF p_review_status IN ('disputed', 'rejected', 'superseded') THEN
    v_stale_count := bible_internal.rg_propagate_staleness_v1(p_claim_id, 'Upstream claim marked ' || p_review_status || coalesce(': ' || nullif(p_review_note, ''), ''));
  END IF;

  INSERT INTO public.rg_claim_revisions (claim_id, version, action, editor_author_id, editor_kind, snapshot)
  VALUES (
    p_claim_id, v_new_ver,
    CASE WHEN p_clear_stale THEN 'reevaluate' ELSE 'review' END,
    v_reviewer_id, 'human',
    jsonb_build_object('review_status', p_review_status, 'epistemic_state', coalesce(p_epistemic_state, v_curr.epistemic_state), 'review_note', p_review_note, 'clear_stale', p_clear_stale)
  );

  RETURN jsonb_build_object('ok', true, 'claim_id', p_claim_id, 'review_status', p_review_status, 'version', v_new_ver, 'downstream_marked_stale', v_stale_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.rg_delete_claim_v1(
  p_claim_id uuid,
  p_expected_version integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $$
DECLARE
  v_settings record;
  v_actor_id uuid := '00000000-0000-0000-0000-00000000a001'::uuid;
  v_curr record;
  v_new_ver int;
  v_stale_count int := 0;
BEGIN
  SELECT * INTO v_settings FROM public.note_settings WHERE id = true;
  IF v_settings IS NULL OR NOT coalesce(v_settings.human_writes_enabled, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'writes_disabled', 'message', 'Human writes are currently disabled'));
  END IF;

  SELECT * INTO v_curr FROM public.rg_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND OR v_curr.status = 'removed' THEN
    RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'not_found', 'message', 'Claim not found'));
  END IF;
  IF v_curr.visibility = 'private' AND (v_curr.owner_user_id IS NULL OR v_curr.owner_user_id IS DISTINCT FROM auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'forbidden', 'message', 'Cannot delete another user private claim'));
  END IF;
  IF p_expected_version IS NOT NULL AND p_expected_version <> v_curr.version THEN
    RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'version_conflict', 'message', 'Version conflict', 'current_version', v_curr.version));
  END IF;

  v_new_ver := v_curr.version + 1;
  UPDATE public.rg_claims SET status = 'removed', version = v_new_ver WHERE id = p_claim_id;
  v_stale_count := bible_internal.rg_propagate_staleness_v1(p_claim_id, 'Upstream claim removed');

  INSERT INTO public.rg_claim_revisions (claim_id, version, action, editor_author_id, editor_kind, snapshot)
  VALUES (p_claim_id, v_new_ver, 'delete', v_actor_id, 'human', jsonb_build_object('status', 'removed'));

  RETURN jsonb_build_object('ok', true, 'status', 'removed', 'version', v_new_ver, 'downstream_marked_stale', v_stale_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.rg_save_trail_v1(p_trail jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $$
DECLARE
  v_settings record;
  v_author_id uuid := '00000000-0000-0000-0000-00000000a001'::uuid;
  v_tkey text := nullif(btrim(coalesce(p_trail->>'trail_key', '')), '');
  v_vis text := coalesce(nullif(p_trail->>'visibility', ''), 'public');
  v_id uuid;
  v_ver int := 1;
BEGIN
  SELECT * INTO v_settings FROM public.note_settings WHERE id = true;
  IF v_settings IS NULL OR NOT coalesce(v_settings.human_writes_enabled, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'writes_disabled', 'message', 'Human writes are disabled'));
  END IF;
  IF v_vis = 'private' AND auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'auth_required', 'message', 'Private trails require authentication'));
  END IF;
  IF v_tkey IS NULL THEN
    v_tkey := 'trail:' || encode(extensions.gen_random_bytes(6), 'hex');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.rg_research_trails
    WHERE trail_key = v_tkey
      AND visibility = 'private'
      AND (owner_user_id IS NULL OR owner_user_id IS DISTINCT FROM auth.uid())
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'forbidden', 'message', 'Cannot overwrite another user private trail'));
  END IF;

  INSERT INTO public.rg_research_trails (
    trail_key, title, research_question, scope_metadata, status,
    frontier, checkpoints, linked_chain_id, author_id, author_kind, owner_user_id, visibility
  ) VALUES (
    v_tkey, btrim(p_trail->>'title'), btrim(p_trail->>'research_question'),
    coalesce(p_trail->'scope_metadata', '{}'::jsonb),
    coalesce(nullif(p_trail->>'status', ''), 'active'),
    coalesce(p_trail->'frontier', '[]'::jsonb),
    coalesce(p_trail->'checkpoints', '[]'::jsonb),
    nullif(p_trail->>'linked_chain_id', ''),
    v_author_id, 'human',
    CASE WHEN v_vis = 'private' THEN auth.uid() ELSE NULL END,
    v_vis
  )
  ON CONFLICT (trail_key) DO UPDATE SET
    title = EXCLUDED.title,
    research_question = EXCLUDED.research_question,
    scope_metadata = EXCLUDED.scope_metadata,
    status = EXCLUDED.status,
    frontier = EXCLUDED.frontier,
    checkpoints = EXCLUDED.checkpoints,
    version = public.rg_research_trails.version + 1
  RETURNING id, version INTO v_id, v_ver;

  RETURN jsonb_build_object('ok', true, 'trail_id', v_id, 'trail_key', v_tkey, 'version', v_ver);
END;
$$;

-- ============================================================================
-- 13. Service-Role-Only AI Agent Write RPCs
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rg_agent_save_batch_v1(p_agent jsonb, p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $$
DECLARE
  v_settings record;
  v_author_id uuid;
  v_hourly_count int;
BEGIN
  SELECT * INTO v_settings FROM public.note_settings WHERE id = true;
  IF v_settings IS NULL OR NOT coalesce(v_settings.ai_writes_enabled, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'writes_disabled', 'message', 'AI writes are currently disabled in note_settings'));
  END IF;

  IF p_agent IS NULL OR jsonb_typeof(p_agent) <> 'object'
     OR trim(coalesce(p_agent->>'provider', '')) = '' OR trim(coalesce(p_agent->>'model', '')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'validation_failed', 'message', 'provider and model are required in p_agent'));
  END IF;

  v_author_id := public.note_resolve_agent_author_v1(p_agent);

  SELECT count(*)::int INTO v_hourly_count
  FROM public.rg_claim_revisions
  WHERE editor_author_id = v_author_id AND created_at > (now() - interval '1 hour');
  IF v_hourly_count >= coalesce(v_settings.ai_writes_per_hour, 60) THEN
    RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'rate_limited', 'message', 'AI hourly write rate limit exceeded for this agent'));
  END IF;

  RETURN bible_internal.rg_apply_batch_v1(v_author_id, 'ai', 'mcp', NULL, p_payload);
END;
$$;

CREATE OR REPLACE FUNCTION public.rg_agent_delete_claim_v1(p_agent jsonb, p_claim_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $$
DECLARE
  v_settings record;
  v_author_id uuid;
  v_curr record;
  v_new_ver int;
  v_stale_count int := 0;
BEGIN
  SELECT * INTO v_settings FROM public.note_settings WHERE id = true;
  IF v_settings IS NULL OR NOT coalesce(v_settings.ai_writes_enabled, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'writes_disabled', 'message', 'AI writes are currently disabled in note_settings'));
  END IF;
  v_author_id := public.note_resolve_agent_author_v1(p_agent);

  SELECT * INTO v_curr FROM public.rg_claims WHERE id = p_claim_id FOR UPDATE;
  IF NOT FOUND OR v_curr.status = 'removed' THEN
    RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'not_found', 'message', 'Claim not found'));
  END IF;
  IF v_curr.author_id <> v_author_id THEN
    RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'forbidden', 'message', 'Agent may only delete its own claims'));
  END IF;

  v_new_ver := v_curr.version + 1;
  UPDATE public.rg_claims SET status = 'removed', version = v_new_ver WHERE id = p_claim_id;
  v_stale_count := bible_internal.rg_propagate_staleness_v1(p_claim_id, 'Upstream AI claim removed');

  INSERT INTO public.rg_claim_revisions (claim_id, version, action, editor_author_id, editor_kind, snapshot)
  VALUES (p_claim_id, v_new_ver, 'delete', v_author_id, 'ai', jsonb_build_object('status', 'removed'));

  RETURN jsonb_build_object('ok', true, 'status', 'removed', 'version', v_new_ver, 'downstream_marked_stale', v_stale_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.rg_agent_save_trail_v1(p_agent jsonb, p_trail jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '10s'
AS $$
DECLARE
  v_settings record;
  v_author_id uuid;
  v_tkey text := nullif(btrim(coalesce(p_trail->>'trail_key', '')), '');
  v_id uuid;
  v_ver int := 1;
BEGIN
  SELECT * INTO v_settings FROM public.note_settings WHERE id = true;
  IF v_settings IS NULL OR NOT coalesce(v_settings.ai_writes_enabled, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'writes_disabled', 'message', 'AI writes are disabled'));
  END IF;
  v_author_id := public.note_resolve_agent_author_v1(p_agent);
  IF v_tkey IS NULL THEN
    v_tkey := 'trail:' || encode(extensions.gen_random_bytes(6), 'hex');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.rg_research_trails
    WHERE trail_key = v_tkey
      AND visibility = 'private'
      AND (owner_user_id IS NULL OR owner_user_id IS DISTINCT FROM auth.uid())
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'forbidden', 'message', 'Cannot overwrite another user private trail'));
  END IF;

  IF EXISTS (SELECT 1 FROM public.rg_research_trails WHERE trail_key = v_tkey AND author_id <> v_author_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'forbidden', 'message', 'Agent cannot overwrite another author trail'));
  END IF;

  INSERT INTO public.rg_research_trails (
    trail_key, title, research_question, scope_metadata, status,
    frontier, checkpoints, linked_chain_id, author_id, author_kind, visibility
  ) VALUES (
    v_tkey, btrim(p_trail->>'title'), btrim(p_trail->>'research_question'),
    coalesce(p_trail->'scope_metadata', '{}'::jsonb),
    coalesce(nullif(p_trail->>'status', ''), 'active'),
    coalesce(p_trail->'frontier', '[]'::jsonb),
    coalesce(p_trail->'checkpoints', '[]'::jsonb),
    nullif(p_trail->>'linked_chain_id', ''),
    v_author_id, 'ai', 'public'
  )
  ON CONFLICT (trail_key) DO UPDATE SET
    title = EXCLUDED.title,
    research_question = EXCLUDED.research_question,
    scope_metadata = EXCLUDED.scope_metadata,
    status = EXCLUDED.status,
    frontier = EXCLUDED.frontier,
    checkpoints = EXCLUDED.checkpoints,
    version = public.rg_research_trails.version + 1
  RETURNING id, version INTO v_id, v_ver;

  RETURN jsonb_build_object('ok', true, 'trail_id', v_id, 'trail_key', v_tkey, 'version', v_ver);
END;
$$;

-- ============================================================================
-- 14. Execution Privileges
-- ============================================================================
REVOKE ALL ON FUNCTION
  bible_internal.rg_propagate_staleness_v1(uuid, text),
  bible_internal.rg_apply_batch_v1(uuid, text, text, uuid, jsonb)
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION
  public.rg_resolve_node_id_v1(text),
  public.rg_resolve_entity_v1(text, text[], integer),
  public.rg_search_v1(text, jsonb, integer, integer),
  public.rg_concept_dossier_v1(text, boolean, integer),
  public.rg_expand_neighborhood_v1(text, text, jsonb, integer, integer),
  public.rg_find_paths_v1(text[], text[], integer, jsonb, integer),
  public.rg_trace_evidence_v1(uuid, integer),
  public.rg_find_contradictions_v1(text, uuid, integer),
  public.rg_list_trails_v1(text, text, integer),
  public.rg_get_trail_v1(text),
  public.rg_save_batch_v1(jsonb),
  public.rg_review_claim_v1(uuid, text, text, text, boolean),
  public.rg_delete_claim_v1(uuid, integer),
  public.rg_save_trail_v1(jsonb),
  public.rg_agent_save_batch_v1(jsonb, jsonb),
  public.rg_agent_delete_claim_v1(jsonb, uuid),
  public.rg_agent_save_trail_v1(jsonb, jsonb)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  public.rg_resolve_node_id_v1(text),
  public.rg_resolve_entity_v1(text, text[], integer),
  public.rg_search_v1(text, jsonb, integer, integer),
  public.rg_concept_dossier_v1(text, boolean, integer),
  public.rg_expand_neighborhood_v1(text, text, jsonb, integer, integer),
  public.rg_find_paths_v1(text[], text[], integer, jsonb, integer),
  public.rg_trace_evidence_v1(uuid, integer),
  public.rg_find_contradictions_v1(text, uuid, integer),
  public.rg_list_trails_v1(text, text, integer),
  public.rg_get_trail_v1(text),
  public.rg_save_batch_v1(jsonb),
  public.rg_review_claim_v1(uuid, text, text, text, boolean),
  public.rg_delete_claim_v1(uuid, integer),
  public.rg_save_trail_v1(jsonb)
TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION
  public.rg_agent_save_batch_v1(jsonb, jsonb),
  public.rg_agent_delete_claim_v1(jsonb, uuid),
  public.rg_agent_save_trail_v1(jsonb, jsonb)
FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.rg_agent_save_batch_v1(jsonb, jsonb),
  public.rg_agent_delete_claim_v1(jsonb, uuid),
  public.rg_agent_save_trail_v1(jsonb, jsonb)
TO service_role;

COMMIT;
