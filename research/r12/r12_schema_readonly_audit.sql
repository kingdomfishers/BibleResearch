-- BibleResearch R12 read-only schema/content audit (2026-11-17).
-- PURPOSE: Inspect existing foundations before importing or redesigning R12 data.
-- READ ONLY: SELECT only. No DDL, DML, service-role keys, file access or personal notes.
-- Run against the BibleResearch Supabase project only. Counts may change.

-- 1. Where is existing identity and semantic data?
SELECT 'canonical_entities' AS relation, COUNT(*) AS rows FROM public.canonical_entities
UNION ALL SELECT 'lemmas', COUNT(*) FROM public.lemmas
UNION ALL SELECT 'lexemes', COUNT(*) FROM public.lexemes
UNION ALL SELECT 'lexical_senses', COUNT(*) FROM public.lexical_senses
UNION ALL SELECT 'lexical_roots', COUNT(*) FROM public.lexical_roots
UNION ALL SELECT 'lemma_root_links', COUNT(*) FROM public.lemma_root_links
UNION ALL SELECT 'lexical_formations', COUNT(*) FROM public.lexical_formations
UNION ALL SELECT 'lexical_connections', COUNT(*) FROM public.lexical_connections
UNION ALL SELECT 'concepts', COUNT(*) FROM public.concepts
UNION ALL SELECT 'concept_properties', COUNT(*) FROM public.concept_properties
UNION ALL SELECT 'concept_external_links', COUNT(*) FROM public.concept_external_links
UNION ALL SELECT 'entity_relationships', COUNT(*) FROM public.entity_relationships
ORDER BY relation;

-- 2. Existing properties are mostly geography metadata, NOT physics assertions.
SELECT property_key, value_type, epistemic_layer, COUNT(*) AS occurrences
FROM public.concept_properties
GROUP BY property_key, value_type, epistemic_layer
ORDER BY occurrences DESC, property_key
LIMIT 60;

-- 3. Existing provider mappings; avoid re-importing these external IDs.
SELECT c.concept_kind, l.provider, l.link_relation, l.license,
       COUNT(*) AS mappings, COUNT(DISTINCT l.concept_id) AS distinct_concepts
FROM public.concept_external_links AS l
JOIN public.concepts AS c ON c.id = l.concept_id
GROUP BY c.concept_kind, l.provider, l.link_relation, l.license
ORDER BY mappings DESC
LIMIT 60;

-- 4. Which existing relational predicates can R12 reuse?
SELECT relation_type, epistemic_layer, origin_mode,
       COUNT(*) AS records,
       COUNT(DISTINCT source_release_id) AS release_count
FROM public.entity_relationships
GROUP BY relation_type, epistemic_layer, origin_mode
ORDER BY records DESC, relation_type
LIMIT 80;

-- 5. Biblical versus geographical concept coverage.
SELECT concept_kind, epistemic_layer, COUNT(*) AS concepts
FROM public.concepts
GROUP BY concept_kind, epistemic_layer
ORDER BY concepts DESC;

-- 6. Field rights gate. Disabled/unverified source fields must not be exported.
SELECT dataset_key, field_group, status, license,
       COUNT(*) AS field_decisions
FROM public.field_license_registry
GROUP BY dataset_key, field_group, status, license
ORDER BY dataset_key, field_group, status
LIMIT 100;

-- 7. Source metadata; avoid returning any private user content.
SELECT id, release_key, dataset, version_label, license
FROM public.source_releases
ORDER BY id
LIMIT 50;
