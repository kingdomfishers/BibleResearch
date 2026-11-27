-- NON-EXECUTED DESIGN PROPOSAL. NOT A PRODUCTION MIGRATION.
-- Date: 2026-11-17. Authoritative local schema and auth design must be reviewed first.
-- Optional only if the existing notes/review system is insufficient for
-- a SMALL set of manually accepted/rejected biblical-sense -> external IDs.
-- DO NOT USE THIS TABLE FOR BULK WORDNET/WIKIDATA GRAPH DATA.
-- No action was taken on the live Supabase project.

BEGIN;

-- Never expose this schema via Supabase Data API or create anon RPC wrappers.
CREATE SCHEMA IF NOT EXISTS r12_internal;
REVOKE ALL ON SCHEMA r12_internal FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS r12_internal.external_mapping_reviews (
    review_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    biblical_entity_key text NOT NULL,
    biblical_sense_id bigint,
    source_edition_key text,
    external_provider text NOT NULL,
    external_id text NOT NULL,
    source_release_key text NOT NULL,
    decision text NOT NULL CHECK (decision IN ('accept','reject','ambiguous')),
    basis text NOT NULL CHECK (basis IN (
       'source_attested','human_review','corpus_context','uncertain'
    )),
    rationale text NOT NULL DEFAULT '',
    source_locator text NOT NULL DEFAULT '',
    source_assertion_ids text[] NOT NULL DEFAULT '{}',
    reviewer_ref text NOT NULL,
    algorithm_version text NOT NULL DEFAULT 'r12-mapping-review-v1',
    recorded_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT r12_review_entity_nonblank CHECK (length(trim(biblical_entity_key)) > 0),
    CONSTRAINT r12_review_external_nonblank CHECK (length(trim(external_id)) > 0),
    CONSTRAINT r12_review_provenance_nonblank CHECK (length(trim(source_release_key)) > 0),
    CONSTRAINT r12_review_unique_mapping UNIQUE (
      biblical_entity_key, external_provider, external_id, source_release_key
    )
);
CREATE INDEX IF NOT EXISTS r12_reviews_provider_lookup
 ON r12_internal.external_mapping_reviews (external_provider,external_id);
CREATE INDEX IF NOT EXISTS r12_reviews_biblical_lookup
 ON r12_internal.external_mapping_reviews (biblical_entity_key,decision);

-- Private defense in depth; no explicit user/anon policies.
ALTER TABLE r12_internal.external_mapping_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON r12_internal.external_mapping_reviews FROM PUBLIC, anon, authenticated;

-- Server-only role example; the local environment/role design must be audited.
-- Keep the schema OUT of Supabase exposed schemas. Never use service_role from UI.
GRANT USAGE ON SCHEMA r12_internal TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON r12_internal.external_mapping_reviews TO service_role;

COMMENT ON TABLE r12_internal.external_mapping_reviews IS
  'Small private reviewed lexical/external mapping decisions. Not a corpus or graph. No anon API.';
COMMENT ON COLUMN r12_internal.external_mapping_reviews.decision IS
  'A reviewed mapping is not proof of biblical symbolism or word etymology.';

COMMIT;

-- Explicit gating before any future deployment:
--   1. Verify this schema does not already exist or conflict with local edits.
--   2. Check existing notes and review data first; prefer reusing them.
--   3. Test in a local disposable database and run schema/advisor checks.
--   4. Inspect grants, RLS, Data API exposed schemas and source licensing.
--   5. Obtain explicit user authorization before applying to a live project.
--   6. Export approved records into versioned offline JSONL for the Worker.
