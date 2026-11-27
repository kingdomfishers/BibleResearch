-- Research Knowledge Graph: Schema, Controlled Predicates, Indexes, and RLS
-- Additive, reversible migration preserving all existing notes, revisions, and source/algorithmic layers.

BEGIN;

-- 1. Extend note_connection_types additively to serve as the unified controlled predicate vocabulary
ALTER TABLE public.note_connection_types
  DROP CONSTRAINT IF EXISTS note_connection_types_category_check;

ALTER TABLE public.note_connection_types
  ADD CONSTRAINT note_connection_types_category_check CHECK (
    category = ANY (ARRAY[
      'linguistic', 'textual', 'thematic', 'typological', 'historical',
      'geographic', 'numerical', 'structural', 'functional', 'causal',
      'symbolic', 'epistemic', 'physical', 'other'
    ]::text[])
  );

ALTER TABLE public.note_connection_types
  ADD COLUMN IF NOT EXISTS inverse_type_key text,
  ADD COLUMN IF NOT EXISTS is_transitive boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS implies_equivalence boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS usage_tier text NOT NULL DEFAULT 'core',
  ADD COLUMN IF NOT EXISTS discouraged boolean NOT NULL DEFAULT false;

-- Preserve and enrich existing 16 predicates + add controlled KG predicates
INSERT INTO public.note_connection_types (
  connection_type, label, inverse_label, category, default_direction,
  is_symmetric, description, is_system, inverse_type_key, is_transitive,
  implies_equivalence, usage_tier, discouraged
) VALUES
  -- Existing 16 preserved
  ('alludes_to', 'alludes to', 'is alluded to by', 'textual', 'directed', false,
   'Literary allusion or motif echo without full formal quotation.', true, 'alluded_to_by', false, false, 'core', false),
  ('contained_in', 'is contained in', 'contains', 'linguistic', 'directed', false,
   'One word or element is morphologically or phonetically contained in another.', true, 'contains', true, false, 'core', false),
  ('contemporary_with', 'is contemporary with', 'is contemporary with', 'historical', 'bidirectional', true,
   'Historical synchronism or overlapping biblical era/event.', true, 'contemporary_with', false, false, 'core', false),
  ('contrasts_with', 'contrasts with', 'contrasts with', 'thematic', 'bidirectional', true,
   'Antithesis, thematic inversion, or intentional literary contrast.', true, 'contrasts_with', false, false, 'core', false),
  ('explains', 'explains', 'is explained by', 'thematic', 'directed', false,
   'One passage, term, or entity glosses, interprets, or explains another.', true, 'explained_by', false, false, 'core', false),
  ('located_at', 'is located at', 'is the location of', 'geographic', 'directed', false,
   'Geographical association between an event/entity and a site.', true, 'location_of', false, false, 'core', false),
  ('other', 'is connected to', 'is connected to', 'other', 'undirected', true,
   'Custom, miscellaneous, or unclassified connection (prefer specific predicates).', true, 'other', false, false, 'fallback', true),
  ('parallels', 'parallels', 'parallels', 'textual', 'bidirectional', true,
   'Structural, thematic, or poetic parallelism.', true, 'parallels', false, false, 'core', false),
  ('quotes', 'quotes', 'is quoted by', 'textual', 'directed', false,
   'Direct or near-verbatim textual citation across passages.', true, 'quoted_by', false, false, 'core', false),
  ('related', 'is related to', 'is related to', 'thematic', 'bidirectional', true,
   'Generic conceptual or thematic association (discouraged in KG; use a specific predicate).', true, 'related', false, false, 'fallback', true),
  ('same_gematria', 'has the same gematria as', 'has the same gematria as', 'numerical', 'bidirectional', true,
   'Numerical equivalence in biblical alphanumeric calculation.', true, 'same_gematria', true, false, 'formal', false),
  ('same_letters', 'has the same letters as', 'has the same letters as', 'linguistic', 'bidirectional', true,
   'Anagrammatic or identical consonantal orthography (not etymological proof).', true, 'same_letters', false, false, 'formal', false),
  ('same_root', 'shares a root with', 'shares a root with', 'linguistic', 'bidirectional', true,
   'Shares a common consonantal or etymological root without asserting direct synonymy.', true, 'same_root', false, false, 'core', false),
  ('sounds_like', 'sounds like', 'sounds like', 'linguistic', 'bidirectional', true,
   'Phonological resemblance or alliteration.', true, 'sounds_like', false, false, 'formal', false),
  ('typifies', 'foreshadows', 'is fulfilled in', 'typological', 'directed', false,
   'Typological pattern, prophetic figure, or antitype fulfillment.', true, 'fulfilled_in', false, false, 'core', false),
  ('wordplay', 'plays on', 'is played on by', 'linguistic', 'directed', false,
   'Paronomasia, pun, or intentional phonological play between terms.', true, 'played_on_by', false, false, 'core', false),

  -- New KG predicates
  ('contains', 'contains', 'is part of', 'structural', 'directed', false,
   'Whole-to-part, structural containment, or inclusion relationship.', true, 'part_of', true, false, 'core', false),
  ('part_of', 'is part of', 'contains', 'structural', 'directed', false,
   'Component, member, or structural sub-unit of a larger whole.', true, 'contains', true, false, 'core', false),
  ('has_property', 'has property', 'is a property of', 'physical', 'directed', false,
   'Entity, material, or concept exhibits a physical, structural, or relational property.', true, 'property_of', false, false, 'core', false),
  ('property_of', 'is a property of', 'has property', 'physical', 'directed', false,
   'Property or attribute characteristic of a material, entity, or concept.', true, 'has_property', false, false, 'core', false),
  ('has_sense', 'has contextual sense', 'is a sense of', 'linguistic', 'directed', false,
   'Links a lemma or term to a disambiguated contextual sense.', true, 'sense_of', false, false, 'core', false),
  ('observed_in', 'is observed in', 'contains observation of', 'textual', 'directed', false,
   'Entity, form, or pattern is directly observed in a specific biblical witness.', true, 'witnesses', false, false, 'core', false),
  ('performs_function', 'performs function', 'is performed by', 'functional', 'directed', false,
   'Entity or component executes a specific biological, physical, ritual, or structural function.', true, 'function_of', false, false, 'core', false),
  ('acts_on', 'acts on', 'is acted on by', 'functional', 'directed', false,
   'Agent, instrument, or process acts upon a target recipient or substrate.', true, 'acted_on_by', false, false, 'core', false),
  ('requires', 'requires', 'is required by', 'causal', 'directed', false,
   'Necessary precondition, input, or constraint for a state, process, or outcome.', true, 'required_by', false, false, 'core', false),
  ('enables', 'enables', 'is enabled by', 'causal', 'directed', false,
   'Provides capacity, condition, or permission for another process or state.', true, 'enabled_by', false, false, 'core', false),
  ('produces', 'produces', 'is produced by', 'causal', 'directed', false,
   'Generates, brings forth, or yields an outcome or product.', true, 'produced_by', false, false, 'core', false),
  ('transforms_into', 'transforms into', 'transforms from', 'causal', 'directed', false,
   'State transition or developmental transformation from input to output.', true, 'transformed_from', false, false, 'core', false),
  ('precedes', 'precedes', 'follows', 'historical', 'directed', false,
   'Ordered sequence in narrative, process, liturgy, or historical timeline.', true, 'follows', true, false, 'core', false),
  ('transmits', 'transmits', 'is transmitted by', 'functional', 'directed', false,
   'Carries, conveys, or propagates information, state, blessing, or signal across steps.', true, 'transmitted_by', false, false, 'core', false),
  ('symbolizes_explicitly', 'explicitly symbolizes', 'is explicitly symbolized by', 'symbolic', 'directed', false,
   'Textually stated symbolic identification within Scripture (e.g., Rev 1:20; Luke 8:11).', true, 'explicitly_symbolized_by', false, false, 'core', false),
  ('formally_resembles', 'formally resembles', 'formally resembles', 'linguistic', 'bidirectional', true,
   'Observed orthographic, consonantal, or structural similarity without claiming historical derivation.', true, 'formally_resembles', false, false, 'formal', false),
  ('shares_root', 'shares documented root with', 'shares documented root with', 'linguistic', 'bidirectional', true,
   'Documented shared etymological root without asserting identical contextual meaning.', true, 'shares_root', false, false, 'core', false),
  ('derived_from_documented', 'is derived from', 'is source root of', 'linguistic', 'directed', false,
   'Documented morphological or lexical derivation.', true, 'source_root_of', false, false, 'core', false),
  ('analogous_to', 'is analogous to', 'is analogous to', 'thematic', 'bidirectional', true,
   'Relational structure-mapping analogy across domains (non-transitive, non-identical).', true, 'analogous_to', false, false, 'core', false),
  ('hypothesized_to_express', 'is hypothesized to express', 'is hypothesized expression of', 'symbolic', 'directed', false,
   'Explicitly labeled interpretive or DLM hypothesis linking an entity/process to an underlying principle.', true, 'hypothesized_expression_of', false, false, 'core', false),
  ('supports', 'supports', 'is supported by', 'epistemic', 'directed', false,
   'Provides corroborating evidence or argumentative support for another claim.', true, 'supported_by', false, false, 'epistemic', false),
  ('challenges', 'challenges', 'is challenged by', 'epistemic', 'directed', false,
   'Presents counterevidence, tension, limitation, or falsifying control against a claim.', true, 'challenged_by', false, false, 'epistemic', false),
  ('depends_on', 'depends on', 'is depended on by', 'epistemic', 'directed', false,
   'Logical or evidential dependency such that changes upstream require reevaluating this claim.', true, 'depended_on_by', false, false, 'epistemic', false),
  ('supersedes', 'supersedes', 'is superseded by', 'epistemic', 'directed', false,
   'Replaces or refines an earlier claim while preserving historical provenance.', true, 'superseded_by', false, false, 'epistemic', false),
  ('refines', 'refines', 'is refined by', 'epistemic', 'directed', false,
   'Narrows scope, sharpens precision, or corrects partial detail of a prior claim.', true, 'refined_by', false, false, 'epistemic', false),
  ('unresolved_with', 'is unresolved with', 'is unresolved with', 'epistemic', 'bidirectional', true,
   'Marks an active tension or competing interpretation awaiting further evidence.', true, 'unresolved_with', false, false, 'epistemic', false)
ON CONFLICT (connection_type) DO UPDATE SET
  inverse_type_key = EXCLUDED.inverse_type_key,
  is_transitive = EXCLUDED.is_transitive,
  implies_equivalence = EXCLUDED.implies_equivalence,
  usage_tier = EXCLUDED.usage_tier,
  discouraged = EXCLUDED.discouraged,
  category = EXCLUDED.category;

-- 2. Research Knowledge Graph Entities (public.rg_nodes)
CREATE TABLE IF NOT EXISTS public.rg_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_key text NOT NULL UNIQUE,
  node_kind text NOT NULL CHECK (node_kind = ANY (ARRAY[
    'passage', 'word_occurrence', 'word_form', 'lemma', 'sense', 'root',
    'letter_or_formation', 'person', 'place', 'event', 'canonical_concept',
    'concept', 'physical_object', 'component', 'property', 'process',
    'mechanism', 'principle', 'mathematical_structure', 'literary_structure',
    'pattern', 'discovery', 'definition', 'hypothesis', 'question',
    'external_source', 'note_ref'
  ]::text[])),
  origin_layer text NOT NULL DEFAULT 'human_research' CHECK (origin_layer = ANY (ARRAY[
    'canonical_ref', 'human_research', 'ai_research', 'external_empirical_citation'
  ]::text[])),
  canonical_entity_id bigint REFERENCES public.canonical_entities(id) ON DELETE SET NULL,
  verse_id integer REFERENCES public.verses(id) ON DELETE SET NULL,
  end_verse_id integer REFERENCES public.verses(id) ON DELETE SET NULL,
  word_id integer REFERENCES public.words(id) ON DELETE SET NULL,
  word_position integer,
  lemma_id bigint REFERENCES public.lemmas(id) ON DELETE SET NULL,
  sense_id bigint REFERENCES public.lexical_senses(id) ON DELETE SET NULL,
  root_id bigint REFERENCES public.lexical_roots(id) ON DELETE SET NULL,
  place_id bigint REFERENCES public.places(id) ON DELETE SET NULL,
  event_id bigint REFERENCES public.chronology_events(id) ON DELETE SET NULL,
  concept_id bigint REFERENCES public.concepts(id) ON DELETE SET NULL,
  note_id uuid REFERENCES public.notes(id) ON DELETE SET NULL,
  source_edition text,
  source_release text,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 240),
  original_script text,
  transliteration text,
  strongs_code text,
  aliases text[] NOT NULL DEFAULT '{}'::text[],
  summary text NOT NULL DEFAULT '' CHECK (char_length(summary) <= 2000),
  definitions jsonb NOT NULL DEFAULT '{}'::jsonb,
  polarity_notes text,
  disambiguation_note text,
  external_uri text CHECK (external_uri IS NULL OR (char_length(external_uri) <= 500 AND external_uri ~* '^https://[^[:space:]<>"]{4,}$')),
  external_citation jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  author_id uuid NOT NULL REFERENCES public.note_authors(id),
  author_kind text NOT NULL CHECK (author_kind IN ('human', 'ai')),
  owner_user_id uuid,
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'published', 'archived', 'removed')),
  review_status text NOT NULL DEFAULT 'unreviewed' CHECK (review_status IN ('unreviewed', 'confirmed', 'disputed', 'rejected', 'superseded')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(label, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(strongs_code, '') || ' ' || coalesce(transliteration, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(summary, '') || ' ' || coalesce(disambiguation_note, '')), 'C')
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rg_nodes_kind_vis ON public.rg_nodes (node_kind, visibility, status);
CREATE INDEX IF NOT EXISTS idx_rg_nodes_strongs ON public.rg_nodes (strongs_code) WHERE strongs_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rg_nodes_verse ON public.rg_nodes (verse_id) WHERE verse_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rg_nodes_lemma ON public.rg_nodes (lemma_id) WHERE lemma_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rg_nodes_word ON public.rg_nodes (word_id) WHERE word_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rg_nodes_concept ON public.rg_nodes (concept_id) WHERE concept_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rg_nodes_place ON public.rg_nodes (place_id) WHERE place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rg_nodes_event ON public.rg_nodes (event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rg_nodes_note ON public.rg_nodes (note_id) WHERE note_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rg_nodes_canon_entity ON public.rg_nodes (canonical_entity_id) WHERE canonical_entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rg_nodes_owner ON public.rg_nodes (owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rg_nodes_aliases_gin ON public.rg_nodes USING gin (aliases);
CREATE INDEX IF NOT EXISTS idx_rg_nodes_tsv_gin ON public.rg_nodes USING gin (tsv);

-- 3. Independently Addressable Claims & Typed Graph Edges (public.rg_claims)
CREATE TABLE IF NOT EXISTS public.rg_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_key text NOT NULL UNIQUE,
  claim_kind text NOT NULL CHECK (claim_kind = ANY (ARRAY[
    'textual_observation', 'linguistic_finding', 'explicit_symbol',
    'literary_pattern', 'physical_mechanism', 'relational_analogy',
    'process_mapping', 'abstract_principle', 'dlm_hypothesis',
    'challenge_critique', 'definition', 'unresolved_question'
  ]::text[])),
  subject_node_id uuid REFERENCES public.rg_nodes(id) ON DELETE RESTRICT,
  predicate text NOT NULL REFERENCES public.note_connection_types(connection_type),
  object_node_id uuid REFERENCES public.rg_nodes(id) ON DELETE RESTRICT,
  direction text NOT NULL DEFAULT 'directed' CHECK (direction IN ('directed', 'bidirectional', 'undirected')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 200),
  assertion_text text NOT NULL CHECK (char_length(assertion_text) BETWEEN 8 AND 1000),
  explanation_md text NOT NULL DEFAULT '' CHECK (char_length(explanation_md) <= 16000),
  contextual_scope text NOT NULL DEFAULT '' CHECK (char_length(contextual_scope) <= 1000),
  limitations text NOT NULL DEFAULT '' CHECK (char_length(limitations) <= 2000),
  unresolved_questions text[] NOT NULL DEFAULT '{}'::text[],
  dlm_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  origin_layer text NOT NULL DEFAULT 'human_research' CHECK (origin_layer IN ('human_research', 'ai_research')),
  evidence_class text NOT NULL CHECK (evidence_class = ANY (ARRAY[
    'TEXT_EXPLICIT', 'TEXT_LINGUISTIC', 'TEXT_INTERTEXTUAL', 'TEXT_PATTERN',
    'SCIENCE_EMPIRICAL', 'DLM_HYPOTHESIS', 'DISPUTED', 'OPEN'
  ]::text[])),
  epistemic_state text NOT NULL DEFAULT 'plausible_hypothesis' CHECK (epistemic_state = ANY (ARRAY[
    'established_observation', 'well_supported_interpretation', 'plausible_hypothesis',
    'speculative', 'disputed', 'open', 'rejected', 'superseded'
  ]::text[])),
  review_status text NOT NULL DEFAULT 'unreviewed' CHECK (review_status IN ('unreviewed', 'confirmed', 'disputed', 'rejected', 'superseded')),
  reviewed_by_author_id uuid REFERENCES public.note_authors(id),
  reviewed_at timestamptz,
  confidence numeric(4,3) CHECK (confidence IS NULL OR (confidence >= 0.0 AND confidence <= 1.0)),
  confidence_dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_potentially_stale boolean NOT NULL DEFAULT false,
  stale_reason text,
  stale_since timestamptz,
  supersedes_claim_id uuid REFERENCES public.rg_claims(id) ON DELETE SET NULL,
  source_note_id uuid REFERENCES public.notes(id) ON DELETE SET NULL,
  author_id uuid NOT NULL REFERENCES public.note_authors(id),
  author_kind text NOT NULL CHECK (author_kind IN ('human', 'ai')),
  created_via text NOT NULL DEFAULT 'ui' CHECK (created_via IN ('ui', 'mcp', 'import')),
  owner_user_id uuid,
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived', 'removed')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  client_request_id text,
  content_hash text,
  source_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(assertion_text, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(contextual_scope, '') || ' ' || coalesce(explanation_md, '')), 'B')
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_rg_claims_distinct_endpoints CHECK (
    subject_node_id IS NULL OR object_node_id IS NULL OR subject_node_id <> object_node_id
  ),
  CONSTRAINT chk_rg_claims_epistemic_partition CHECK (
    (evidence_class <> 'DLM_HYPOTHESIS' OR epistemic_state <> 'established_observation')
    AND (claim_kind <> 'dlm_hypothesis' OR evidence_class = 'DLM_HYPOTHESIS')
    AND (claim_kind <> 'physical_mechanism' OR evidence_class IN ('SCIENCE_EMPIRICAL', 'DISPUTED', 'OPEN'))
  )
);

CREATE INDEX IF NOT EXISTS idx_rg_claims_subj ON public.rg_claims (subject_node_id, status, visibility) WHERE subject_node_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rg_claims_obj ON public.rg_claims (object_node_id, status, visibility) WHERE object_node_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rg_claims_pred ON public.rg_claims (predicate, status, visibility);
CREATE INDEX IF NOT EXISTS idx_rg_claims_ev_rev ON public.rg_claims (evidence_class, review_status, visibility, status);
CREATE INDEX IF NOT EXISTS idx_rg_claims_stale ON public.rg_claims (is_potentially_stale, updated_at DESC) WHERE is_potentially_stale = true;
CREATE INDEX IF NOT EXISTS idx_rg_claims_author_req ON public.rg_claims (author_id, client_request_id) WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_rg_claims_author_req ON public.rg_claims (author_id, client_request_id) WHERE client_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rg_claims_dedupe ON public.rg_claims (author_id, content_hash, created_at DESC) WHERE status <> 'removed';
CREATE INDEX IF NOT EXISTS idx_rg_claims_owner ON public.rg_claims (owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rg_claims_tsv_gin ON public.rg_claims USING gin (tsv);

-- 4. Multi-Participant Ordered Slots (n-ary processes, patterns, Gentner structure mappings)
CREATE TABLE IF NOT EXISTS public.rg_claim_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES public.rg_claims(id) ON DELETE CASCADE,
  node_id uuid NOT NULL REFERENCES public.rg_nodes(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role = ANY (ARRAY[
    'subject', 'object', 'agent', 'patient', 'recipient', 'instrument',
    'source', 'destination', 'condition', 'outcome', 'medium', 'context',
    'slot_a', 'slot_b', 'unmatched', 'control', 'mention'
  ]::text[])),
  ordinal integer NOT NULL DEFAULT 0 CHECK (ordinal >= 0),
  slot_key text,
  notes text CHECK (notes IS NULL OR char_length(notes) <= 500)
);

CREATE INDEX IF NOT EXISTS idx_rg_participants_claim ON public.rg_claim_participants (claim_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_rg_participants_node ON public.rg_claim_participants (node_id, claim_id);

-- 5. Supporting Evidence & Counterevidence (supporting, counterexample, control, limiting_case)
CREATE TABLE IF NOT EXISTS public.rg_claim_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES public.rg_claims(id) ON DELETE CASCADE,
  polarity text NOT NULL DEFAULT 'supporting' CHECK (polarity IN ('supporting', 'counterexample', 'control', 'limiting_case')),
  evidence_kind text NOT NULL CHECK (evidence_kind = ANY (ARRAY[
    'scripture_verse', 'word_occurrence', 'lemma', 'algorithm_edge',
    'external_source', 'prior_claim', 'note_ref'
  ]::text[])),
  source_key text NOT NULL CHECK (char_length(source_key) BETWEEN 2 AND 300),
  node_id uuid REFERENCES public.rg_nodes(id) ON DELETE SET NULL,
  verse_id integer REFERENCES public.verses(id) ON DELETE SET NULL,
  end_verse_id integer REFERENCES public.verses(id) ON DELETE SET NULL,
  word_id integer REFERENCES public.words(id) ON DELETE SET NULL,
  word_position integer,
  lemma_id bigint REFERENCES public.lemmas(id) ON DELETE SET NULL,
  target_claim_id uuid REFERENCES public.rg_claims(id) ON DELETE SET NULL,
  target_note_id uuid REFERENCES public.notes(id) ON DELETE SET NULL,
  source_edition text,
  source_release text,
  algorithm_evidence_id text,
  external_title text CHECK (external_title IS NULL OR char_length(external_title) <= 240),
  external_url text CHECK (external_url IS NULL OR (char_length(external_url) <= 500 AND external_url ~* '^https://[^[:space:]<>"]{4,}$')),
  external_locator text CHECK (external_locator IS NULL OR char_length(external_locator) <= 240),
  citation_text text CHECK (citation_text IS NULL OR char_length(citation_text) <= 1000),
  explanation text NOT NULL DEFAULT '' CHECK (char_length(explanation) <= 1500),
  is_primary_source boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rg_evidence_claim ON public.rg_claim_evidence (claim_id, polarity);
CREATE INDEX IF NOT EXISTS idx_rg_evidence_source_key ON public.rg_claim_evidence (source_key);
CREATE INDEX IF NOT EXISTS idx_rg_evidence_verse ON public.rg_claim_evidence (verse_id) WHERE verse_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rg_evidence_lemma ON public.rg_claim_evidence (lemma_id) WHERE lemma_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rg_evidence_target_claim ON public.rg_claim_evidence (target_claim_id) WHERE target_claim_id IS NOT NULL;

-- 6. Typed Claim-to-Claim Dependency / Support / Challenge / Supersession Links
CREATE TABLE IF NOT EXISTS public.rg_claim_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_claim_id uuid NOT NULL REFERENCES public.rg_claims(id) ON DELETE CASCADE,
  to_claim_id uuid NOT NULL REFERENCES public.rg_claims(id) ON DELETE CASCADE,
  link_type text NOT NULL CHECK (link_type IN ('supports', 'challenges', 'depends_on', 'supersedes', 'refines', 'contradicts', 'explains')),
  explanation text NOT NULL DEFAULT '' CHECK (char_length(explanation) <= 1000),
  author_id uuid NOT NULL REFERENCES public.note_authors(id),
  author_kind text NOT NULL CHECK (author_kind IN ('human', 'ai')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_rg_claim_links_distinct CHECK (from_claim_id <> to_claim_id),
  CONSTRAINT uq_rg_claim_links UNIQUE (from_claim_id, to_claim_id, link_type)
);

CREATE INDEX IF NOT EXISTS idx_rg_claim_links_from ON public.rg_claim_links (from_claim_id, link_type);
CREATE INDEX IF NOT EXISTS idx_rg_claim_links_to ON public.rg_claim_links (to_claim_id, link_type);

-- 7. Immutable Claim Revision History
CREATE TABLE IF NOT EXISTS public.rg_claim_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES public.rg_claims(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version >= 1),
  action text NOT NULL CHECK (action IN ('create', 'update', 'review', 'challenge', 'supersede', 'delete', 'reevaluate')),
  editor_author_id uuid NOT NULL REFERENCES public.note_authors(id),
  editor_kind text NOT NULL CHECK (editor_kind IN ('human', 'ai')),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rg_claim_revisions_claim ON public.rg_claim_revisions (claim_id, version DESC);

-- 8. Durable Cross-Session Research Trails
CREATE TABLE IF NOT EXISTS public.rg_research_trails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trail_key text NOT NULL UNIQUE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 200),
  research_question text NOT NULL CHECK (char_length(research_question) BETWEEN 5 AND 1000),
  scope_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'archived')),
  frontier jsonb NOT NULL DEFAULT '[]'::jsonb,
  checkpoints jsonb NOT NULL DEFAULT '[]'::jsonb,
  linked_chain_id text REFERENCES public.mcp_connection_chains(chain_id) ON DELETE SET NULL,
  author_id uuid NOT NULL REFERENCES public.note_authors(id),
  author_kind text NOT NULL CHECK (author_kind IN ('human', 'ai')),
  owner_user_id uuid,
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rg_trails_status_vis ON public.rg_research_trails (status, visibility, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_rg_trails_owner ON public.rg_research_trails (owner_user_id) WHERE owner_user_id IS NOT NULL;

-- 9. Trigger helpers (cycle prevention on depends_on/supersedes + updated_at)
CREATE OR REPLACE FUNCTION bible_internal.rg_guard_claim_link_cycle_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_cycle boolean;
BEGIN
  IF NEW.link_type IN ('depends_on', 'supersedes') THEN
    WITH RECURSIVE walk(cid, depth) AS (
      SELECT NEW.to_claim_id, 1
      UNION ALL
      SELECT l.to_claim_id, w.depth + 1
      FROM walk w
      JOIN public.rg_claim_links l ON l.from_claim_id = w.cid
      WHERE l.link_type IN ('depends_on', 'supersedes')
        AND w.depth < 16
    )
    SELECT EXISTS (SELECT 1 FROM walk WHERE cid = NEW.from_claim_id) INTO v_cycle;
    IF v_cycle THEN
      RAISE EXCEPTION 'Cyclic % dependency is disallowed between % and %', NEW.link_type, NEW.from_claim_id, NEW.to_claim_id
        USING ERRCODE = '22000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rg_claim_links_no_cycle ON public.rg_claim_links;
CREATE TRIGGER trg_rg_claim_links_no_cycle
  BEFORE INSERT OR UPDATE ON public.rg_claim_links
  FOR EACH ROW EXECUTE FUNCTION bible_internal.rg_guard_claim_link_cycle_v1();

DROP TRIGGER IF EXISTS trg_rg_nodes_updated_at ON public.rg_nodes;
CREATE TRIGGER trg_rg_nodes_updated_at
  BEFORE UPDATE ON public.rg_nodes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_rg_claims_updated_at ON public.rg_claims;
CREATE TRIGGER trg_rg_claims_updated_at
  BEFORE UPDATE ON public.rg_claims
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_rg_trails_updated_at ON public.rg_research_trails;
CREATE TRIGGER trg_rg_trails_updated_at
  BEFORE UPDATE ON public.rg_research_trails
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 10. Row-Level Security & Strict Grants
ALTER TABLE public.rg_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rg_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rg_claim_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rg_claim_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rg_claim_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rg_claim_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rg_research_trails ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.rg_nodes,
  public.rg_claims,
  public.rg_claim_participants,
  public.rg_claim_evidence,
  public.rg_claim_links,
  public.rg_claim_revisions,
  public.rg_research_trails
FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE
  public.rg_nodes,
  public.rg_claims,
  public.rg_claim_participants,
  public.rg_claim_evidence,
  public.rg_claim_links,
  public.rg_claim_revisions,
  public.rg_research_trails
TO anon, authenticated;

GRANT ALL ON TABLE
  public.rg_nodes,
  public.rg_claims,
  public.rg_claim_participants,
  public.rg_claim_evidence,
  public.rg_claim_links,
  public.rg_claim_revisions,
  public.rg_research_trails
TO service_role;

-- Helper predicates inside RLS: no private research leakage through indirect edges, backlinks, or targets
DROP POLICY IF EXISTS p_rg_nodes_select ON public.rg_nodes;
CREATE POLICY p_rg_nodes_select ON public.rg_nodes
  FOR SELECT TO anon, authenticated
  USING (
    (visibility = 'public' AND status IN ('active', 'published'))
    OR (owner_user_id IS NOT NULL AND owner_user_id = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS p_rg_claims_select ON public.rg_claims;
CREATE POLICY p_rg_claims_select ON public.rg_claims
  FOR SELECT TO anon, authenticated
  USING (
    (
      (visibility = 'public' AND status = 'published')
      OR (owner_user_id IS NOT NULL AND owner_user_id = (SELECT auth.uid()))
    )
    AND (
      subject_node_id IS NULL OR EXISTS (
        SELECT 1 FROM public.rg_nodes sn
        WHERE sn.id = rg_claims.subject_node_id
          AND ((sn.visibility = 'public' AND sn.status IN ('active', 'published'))
               OR (sn.owner_user_id IS NOT NULL AND sn.owner_user_id = (SELECT auth.uid())))
      )
    )
    AND (
      object_node_id IS NULL OR EXISTS (
        SELECT 1 FROM public.rg_nodes onode
        WHERE onode.id = rg_claims.object_node_id
          AND ((onode.visibility = 'public' AND onode.status IN ('active', 'published'))
               OR (onode.owner_user_id IS NOT NULL AND onode.owner_user_id = (SELECT auth.uid())))
      )
    )
  );

DROP POLICY IF EXISTS p_rg_claim_participants_select ON public.rg_claim_participants;
CREATE POLICY p_rg_claim_participants_select ON public.rg_claim_participants
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.rg_claims c
      WHERE c.id = rg_claim_participants.claim_id
        AND ((c.visibility = 'public' AND c.status = 'published')
             OR (c.owner_user_id IS NOT NULL AND c.owner_user_id = (SELECT auth.uid())))
    )
    AND EXISTS (
      SELECT 1 FROM public.rg_nodes n
      WHERE n.id = rg_claim_participants.node_id
        AND ((n.visibility = 'public' AND n.status IN ('active', 'published'))
             OR (n.owner_user_id IS NOT NULL AND n.owner_user_id = (SELECT auth.uid())))
    )
  );

DROP POLICY IF EXISTS p_rg_claim_evidence_select ON public.rg_claim_evidence;
CREATE POLICY p_rg_claim_evidence_select ON public.rg_claim_evidence
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.rg_claims c
      WHERE c.id = rg_claim_evidence.claim_id
        AND ((c.visibility = 'public' AND c.status = 'published')
             OR (c.owner_user_id IS NOT NULL AND c.owner_user_id = (SELECT auth.uid())))
    )
    AND (
      node_id IS NULL OR EXISTS (
        SELECT 1 FROM public.rg_nodes n
        WHERE n.id = rg_claim_evidence.node_id
          AND ((n.visibility = 'public' AND n.status IN ('active', 'published'))
               OR (n.owner_user_id IS NOT NULL AND n.owner_user_id = (SELECT auth.uid())))
      )
    )
    AND (
      target_claim_id IS NULL OR EXISTS (
        SELECT 1 FROM public.rg_claims tc
        WHERE tc.id = rg_claim_evidence.target_claim_id
          AND ((tc.visibility = 'public' AND tc.status = 'published')
               OR (tc.owner_user_id IS NOT NULL AND tc.owner_user_id = (SELECT auth.uid())))
      )
    )
    AND (
      target_note_id IS NULL OR EXISTS (
        SELECT 1 FROM public.notes tn
        WHERE tn.id = rg_claim_evidence.target_note_id
          AND tn.visibility = 'public' AND tn.status = 'published'
      )
    )
  );

DROP POLICY IF EXISTS p_rg_claim_links_select ON public.rg_claim_links;
CREATE POLICY p_rg_claim_links_select ON public.rg_claim_links
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.rg_claims fc
      WHERE fc.id = rg_claim_links.from_claim_id
        AND ((fc.visibility = 'public' AND fc.status = 'published')
             OR (fc.owner_user_id IS NOT NULL AND fc.owner_user_id = (SELECT auth.uid())))
    )
    AND EXISTS (
      SELECT 1 FROM public.rg_claims tc
      WHERE tc.id = rg_claim_links.to_claim_id
        AND ((tc.visibility = 'public' AND tc.status = 'published')
             OR (tc.owner_user_id IS NOT NULL AND tc.owner_user_id = (SELECT auth.uid())))
    )
  );

DROP POLICY IF EXISTS p_rg_claim_revisions_select ON public.rg_claim_revisions;
CREATE POLICY p_rg_claim_revisions_select ON public.rg_claim_revisions
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.rg_claims c
      WHERE c.id = rg_claim_revisions.claim_id
        AND ((c.visibility = 'public' AND c.status = 'published')
             OR (c.owner_user_id IS NOT NULL AND c.owner_user_id = (SELECT auth.uid())))
    )
  );

DROP POLICY IF EXISTS p_rg_research_trails_select ON public.rg_research_trails;
CREATE POLICY p_rg_research_trails_select ON public.rg_research_trails
  FOR SELECT TO anon, authenticated
  USING (
    (visibility = 'public' AND status <> 'archived')
    OR (owner_user_id IS NOT NULL AND owner_user_id = (SELECT auth.uid()))
  );

-- 11. Harden legacy get_note_v1 anchors so a public note's anchor targeting a private/removed note cannot leak its label
-- Note: note_json_v1, agent_save_note_v1, agent_delete_note_v1 are already revoked from anon/authenticated/PUBLIC.
REVOKE ALL ON FUNCTION public.note_json_v1(uuid) FROM PUBLIC, anon, authenticated;

COMMIT;
