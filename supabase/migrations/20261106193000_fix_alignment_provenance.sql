-- ============================================================================
-- Migration: 20261106193000_fix_alignment_provenance.sql
-- Description: Correct alignment evidence provenance:
--              1. Insert relation_type 'source_provided_lexical_equivalent' into relation_types.
--              2. Reclassify 383 MACULA greekstrong records from explicit_source_word_alignment
--                 to source_provided_lexical_equivalent with reviewed status and enabled_origin_unverified note.
--              3. Update hebrew_lxx_word_alignments rows with Clear-Bible/macula-hebrew
--                 provenance to editorial_reference_collation.
--              4. Update lookup_hebrew_to_greek_alignments_v1 and
--                 lookup_greek_to_hebrew_alignments_v1 to support source_provided_lexical_equivalent.
-- ============================================================================

-- 1. Insert source_provided_lexical_equivalent into relation_types
INSERT INTO public.relation_types (
  relation_type,
  category,
  is_symmetric,
  implies_synonymy,
  description
) VALUES (
  'source_provided_lexical_equivalent',
  'lexical',
  false,
  false,
  'Source-provided lexical dictionary equivalent from dataset annotations (origin unverified as manuscript alignment).'
) ON CONFLICT (relation_type) DO UPDATE
SET description = EXCLUDED.description;

-- 2. Reclassify 383 MACULA dictionary equivalence records
UPDATE public.entity_relationships
SET relation_type = 'source_provided_lexical_equivalent',
    review_status = 'reviewed',
    evidence_summary = 'Source-provided lexical dictionary equivalent from MACULA Hebrew greekstrong attribute (field_license: enabled_origin_unverified).'
WHERE derivation_method = 'macula_hebrew_greek_equivalent'
  AND relation_type = 'explicit_source_word_alignment';

-- 3. Update hebrew_lxx_word_alignments: relabel Clear-Bible/macula-hebrew to editorial_reference_collation
UPDATE public.hebrew_lxx_word_alignments
SET algorithm_or_source = 'editorial_reference_collation',
    evidence_summary = evidence_summary || ' [Editorial reference collation between MT and Swete Septuagint]'
WHERE algorithm_or_source = 'Clear-Bible/macula-hebrew';

-- 4. Update lookup_hebrew_to_greek_alignments_v1
CREATE OR REPLACE FUNCTION public.lookup_hebrew_to_greek_alignments_v1(
  p_lemma_query text,
  p_limit integer DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_query text := btrim(coalesce(p_lemma_query, ''));
  v_limit integer := greatest(coalesce(p_limit, 25), 1);
  v_strong_norm text;
  v_heb_entity record;
  v_alignments jsonb := '[]'::jsonb;
  v_total integer := 0;
  v_license_status text;
  v_prov record;
BEGIN
  IF v_query = '' THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'invalid_request',
      'message', 'p_lemma_query must not be empty'
    );
  END IF;

  SELECT status INTO v_license_status
  FROM public.field_license_registry
  WHERE dataset_key = 'macula-hebrew' AND field_name = 'greekstrong';

  IF v_license_status IS NULL OR v_license_status NOT IN ('enabled_verified', 'enabled_origin_unverified') THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'gated_license_restricted',
      'message', 'Hebrew-to-Greek alignments gated pending license/provenance verification.',
      'license_status', coalesce(v_license_status, 'disabled_pending_audit')
    );
  END IF;

  IF v_query ~* '^[Hh]?[0-9]+[A-Za-z]?$' THEN
    v_strong_norm := 'lemma:H' || lpad(regexp_replace(v_query, '[^0-9]', '', 'g'), 4, '0');
  ELSIF v_query ~* '^lemma:H[0-9]+[A-Za-z]?$' THEN
    v_strong_norm := v_query;
  END IF;

  SELECT ce.id, ce.entity_key, ce.display_label, ce.language, l.lemma_script, l.transliteration, l.base_strongs
  INTO v_heb_entity
  FROM public.canonical_entities ce
  LEFT JOIN public.lemmas l ON l.id = ce.lemma_id
  WHERE ce.entity_kind = 'lemma'
    AND ce.language = 'hbo'
    AND (
      ce.entity_key = v_query
      OR (v_strong_norm IS NOT NULL AND (ce.entity_key = v_strong_norm OR ce.entity_key LIKE v_strong_norm || '%'))
      OR l.lemma_script = v_query
      OR public.strip_hebrew_all(l.lemma_script) = public.strip_hebrew_all(v_query)
      OR l.transliteration ILIKE v_query
      OR ce.display_label ILIKE '%' || v_query || '%'
    )
  ORDER BY
    CASE WHEN ce.entity_key = v_strong_norm THEN 0
         WHEN ce.entity_key LIKE v_strong_norm || '%' THEN 1
         WHEN l.lemma_script = v_query THEN 2
         ELSE 3 END
  LIMIT 1;

  IF v_heb_entity.id IS NULL THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'not_found',
      'query', p_lemma_query,
      'message', 'Hebrew lemma not found'
    );
  END IF;

  SELECT
    coalesce(jsonb_agg(
      jsonb_build_object(
        'greek_lemma_key', sub.entity_key,
        'greek_display_label', sub.display_label,
        'greek_script', sub.lemma_script,
        'greek_transliteration', sub.transliteration,
        'greek_strong', sub.greek_strong,
        'relation_type', sub.relation_type,
        'derivation_method', sub.derivation_method,
        'evidence_summary', sub.evidence_summary,
        'occurrence_count', sub.occurrence_count,
        'sample_verses', sub.sample_verses
      )
    ), '[]'::jsonb),
    count(*)
  INTO v_alignments, v_total
  FROM (
    SELECT
      ce_grk.entity_key,
      ce_grk.display_label,
      l_grk.lemma_script,
      l_grk.transliteration,
      coalesce(l_grk.base_strongs, 'G' || g.field_value) AS greek_strong,
      er.relation_type,
      er.derivation_method,
      er.evidence_summary,
      count(DISTINCT m.id) AS occurrence_count,
      array_agg(DISTINCT m.book || ' ' || m.chapter_mt || ':' || m.verse_mt) FILTER (WHERE m.book IS NOT NULL) AS sample_verses
    FROM public.entity_relationships er
    JOIN public.canonical_entities ce_grk ON ce_grk.id = er.object_entity_id
    LEFT JOIN public.lemmas l_grk ON l_grk.id = ce_grk.lemma_id
    LEFT JOIN public.macula_gated_field_values g ON g.field_name = 'greekstrong'
      AND ('lemma:G' || lpad(g.field_value, 4, '0') = ce_grk.entity_key OR ce_grk.entity_key LIKE 'lemma:G' || lpad(g.field_value, 4, '0') || '%')
    LEFT JOIN public.macula_hebrew_morphemes m ON m.id = g.morpheme_id
      AND ('lemma:H' || lpad(regexp_replace(m.strong_x, '[^0-9]', '', 'g'), 4, '0') = v_heb_entity.entity_key
           OR v_heb_entity.entity_key LIKE 'lemma:H' || lpad(regexp_replace(m.strong_x, '[^0-9]', '', 'g'), 4, '0') || '%')
    WHERE er.subject_entity_id = v_heb_entity.id
      AND er.relation_type IN ('explicit_source_word_alignment', 'source_provided_lexical_equivalent')
    GROUP BY
      ce_grk.entity_key,
      ce_grk.display_label,
      l_grk.lemma_script,
      l_grk.transliteration,
      l_grk.base_strongs,
      g.field_value,
      er.relation_type,
      er.derivation_method,
      er.evidence_summary
    ORDER BY occurrence_count DESC, ce_grk.entity_key
    LIMIT v_limit
  ) sub;

  SELECT r.dataset, r.version_label, r.license, r.attribution
  INTO v_prov
  FROM public.source_releases r
  WHERE r.release_key = 'macula-hebrew-47db250' OR r.dataset ILIKE '%macula-hebrew%'
  LIMIT 1;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'status', 'ok',
    'query', p_lemma_query,
    'hebrew_lemma', jsonb_build_object(
      'entity_key', v_heb_entity.entity_key,
      'display_label', v_heb_entity.display_label,
      'language', v_heb_entity.language,
      'lemma_script', v_heb_entity.lemma_script,
      'transliteration', v_heb_entity.transliteration,
      'base_strongs', v_heb_entity.base_strongs
    ),
    'license_status', v_license_status,
    'total_alignments', v_total,
    'alignments', v_alignments,
    'provenance', jsonb_build_object(
      'dataset', coalesce(v_prov.dataset, 'Clear-Bible/macula-hebrew'),
      'release', coalesce(v_prov.version_label, '2026-04-24 (47db250)'),
      'license', coalesce(v_prov.license, 'CC BY 4.0'),
      'attribution', coalesce(v_prov.attribution, 'Clear Bible / Biblica')
    )
  );
END;
$$;

-- 5. Update lookup_greek_to_hebrew_alignments_v1
CREATE OR REPLACE FUNCTION public.lookup_greek_to_hebrew_alignments_v1(
  p_greek_query text,
  p_limit integer DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_query text := btrim(coalesce(p_greek_query, ''));
  v_limit integer := greatest(coalesce(p_limit, 25), 1);
  v_strong_norm text;
  v_clean_strong text;
  v_grk_entity record;
  v_alignments jsonb := '[]'::jsonb;
  v_total integer := 0;
  v_license_status text;
  v_prov record;
BEGIN
  IF v_query = '' THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'invalid_request',
      'message', 'p_greek_query must not be empty'
    );
  END IF;

  SELECT status INTO v_license_status
  FROM public.field_license_registry
  WHERE dataset_key = 'macula-hebrew' AND field_name = 'greekstrong';

  IF v_license_status IS NULL OR v_license_status NOT IN ('enabled_verified', 'enabled_origin_unverified') THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'gated_license_restricted',
      'message', 'Greek-to-Hebrew alignments gated pending license/provenance verification.',
      'license_status', coalesce(v_license_status, 'disabled_pending_audit')
    );
  END IF;

  IF v_query ~* '^[Gg]?[0-9]+[A-Za-z]?$' THEN
    v_clean_strong := 'G' || regexp_replace(v_query, '[^0-9]', '', 'g');
    v_strong_norm := 'lemma:G' || lpad(regexp_replace(v_query, '[^0-9]', '', 'g'), 4, '0');
  ELSIF v_query ~* '^lemma:G[0-9]+[A-Za-z]?$' THEN
    v_clean_strong := regexp_replace(v_query, '^lemma:', '');
    v_strong_norm := v_query;
  END IF;

  SELECT ce.id, ce.entity_key, ce.display_label, ce.language, l.lemma_script, l.transliteration, l.base_strongs
  INTO v_grk_entity
  FROM public.canonical_entities ce
  LEFT JOIN public.lemmas l ON l.id = ce.lemma_id
  WHERE ce.entity_kind = 'lemma'
    AND ce.language = 'grc'
    AND (
      ce.entity_key = v_query
      OR (v_strong_norm IS NOT NULL AND (ce.entity_key = v_strong_norm OR ce.entity_key LIKE v_strong_norm || '%'))
      OR l.lemma_script = v_query
      OR public.strip_greek_diacritics(l.lemma_script) = public.strip_greek_diacritics(v_query)
      OR l.transliteration ILIKE v_query
      OR ce.display_label ILIKE '%' || v_query || '%'
    )
  ORDER BY
    CASE WHEN ce.entity_key = v_strong_norm THEN 0
         WHEN ce.entity_key LIKE v_strong_norm || '%' THEN 1
         WHEN l.lemma_script = v_query THEN 2
         ELSE 3 END
  LIMIT 1;

  IF v_grk_entity.id IS NULL THEN
    RETURN jsonb_build_object(
      'schema_version', 1,
      'status', 'not_found',
      'query', p_greek_query,
      'message', 'Greek lemma not found'
    );
  END IF;

  SELECT
    coalesce(jsonb_agg(
      jsonb_build_object(
        'hebrew_lemma_key', sub.entity_key,
        'hebrew_display_label', sub.display_label,
        'hebrew_script', sub.lemma_script,
        'hebrew_transliteration', sub.transliteration,
        'hebrew_strong', sub.hebrew_strong,
        'relation_type', sub.relation_type,
        'derivation_method', sub.derivation_method,
        'evidence_summary', sub.evidence_summary,
        'occurrence_count', sub.occurrence_count,
        'sample_verses', sub.sample_verses
      )
    ), '[]'::jsonb),
    count(*)
  INTO v_alignments, v_total
  FROM (
    SELECT
      ce_heb.entity_key,
      ce_heb.display_label,
      l_heb.lemma_script,
      l_heb.transliteration,
      coalesce(l_heb.base_strongs, 'H' || regexp_replace(m.strong_x, '[^0-9]', '', 'g')) AS hebrew_strong,
      er.relation_type,
      er.derivation_method,
      er.evidence_summary,
      count(DISTINCT m.id) AS occurrence_count,
      array_agg(DISTINCT m.book || ' ' || m.chapter_mt || ':' || m.verse_mt) FILTER (WHERE m.book IS NOT NULL) AS sample_verses
    FROM public.entity_relationships er
    JOIN public.canonical_entities ce_heb ON ce_heb.id = er.subject_entity_id
    LEFT JOIN public.lemmas l_heb ON l_heb.id = ce_heb.lemma_id
    LEFT JOIN public.macula_gated_field_values g ON g.field_name = 'greekstrong'
      AND ('lemma:G' || lpad(g.field_value, 4, '0') = v_grk_entity.entity_key OR v_grk_entity.entity_key LIKE 'lemma:G' || lpad(g.field_value, 4, '0') || '%')
    LEFT JOIN public.macula_hebrew_morphemes m ON m.id = g.morpheme_id
      AND ('lemma:H' || lpad(regexp_replace(m.strong_x, '[^0-9]', '', 'g'), 4, '0') = ce_heb.entity_key
           OR ce_heb.entity_key LIKE 'lemma:H' || lpad(regexp_replace(m.strong_x, '[^0-9]', '', 'g'), 4, '0') || '%')
    WHERE er.object_entity_id = v_grk_entity.id
      AND er.relation_type IN ('explicit_source_word_alignment', 'source_provided_lexical_equivalent')
    GROUP BY
      ce_heb.entity_key,
      ce_heb.display_label,
      l_heb.lemma_script,
      l_heb.transliteration,
      l_heb.base_strongs,
      m.strong_x,
      er.relation_type,
      er.derivation_method,
      er.evidence_summary
    ORDER BY occurrence_count DESC, ce_heb.entity_key
    LIMIT v_limit
  ) sub;

  SELECT r.dataset, r.version_label, r.license, r.attribution
  INTO v_prov
  FROM public.source_releases r
  WHERE r.release_key = 'macula-hebrew-47db250' OR r.dataset ILIKE '%macula-hebrew%'
  LIMIT 1;

  RETURN jsonb_build_object(
    'schema_version', 1,
    'status', 'ok',
    'query', p_greek_query,
    'greek_lemma', jsonb_build_object(
      'entity_key', v_grk_entity.entity_key,
      'display_label', v_grk_entity.display_label,
      'language', v_grk_entity.language,
      'lemma_script', v_grk_entity.lemma_script,
      'transliteration', v_grk_entity.transliteration,
      'base_strongs', v_grk_entity.base_strongs
    ),
    'license_status', v_license_status,
    'total_alignments', v_total,
    'alignments', v_alignments,
    'provenance', jsonb_build_object(
      'dataset', coalesce(v_prov.dataset, 'Clear-Bible/macula-hebrew'),
      'release', coalesce(v_prov.version_label, '2026-04-24 (47db250)'),
      'license', coalesce(v_prov.license, 'CC BY 4.0'),
      'attribution', coalesce(v_prov.attribution, 'Clear Bible / Biblica')
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.lookup_hebrew_to_greek_alignments_v1(text, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lookup_greek_to_hebrew_alignments_v1(text, integer) TO anon, authenticated, service_role;
