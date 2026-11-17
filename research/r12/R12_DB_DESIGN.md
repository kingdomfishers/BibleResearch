# R12 Database & Evidence Storage Design — grounded in live Supabase metadata

Date: 2026-11-17. State: **proposal**, no database migration, Worker deployment, or corpus modification performed.

Related: [Main plan](../../R12_Plan.md), [property bridge prototype](property-bridges.mjs), [path ranker prototype](proof-ranker.mjs), [source catalog](data-sources.json).

## 1. Decision: one discovery graph, existing Supabase metadata, Cloudflare static materialization

Do **not** build the immutable biblical/world knowledge graph in Postgres. Existing R8/R9A/R9B/R9C already provide canonical identities and sharded graph serving on Cloudflare. Store bulk external semantic/physical relationships, pattern signatures and multihop recommendations in versioned offline JSONL/shards, **not** in new Supabase tables. This respects the existing low-storage/free-tier constraint.

Supabase stays the source for canonical identity, chronology/geography metadata, mutable notes and **small human-reviewed decisions** if such decisions actually become necessary. The WordInspector, Worker gateway and MCP should resolve to the *same* immutable evidence IDs and paths.

Do not run any SQL in this design against the live database: the optional migration below is a future proposal only.

## 2. What was actually observed (read-only connected tools)

Project: the existing BibleResearch Supabase project named Connection, PostgreSQL 17.4, EU region eu-central-2. Counts from Supabase table metadata are approximations, not a transactionally consistent verification.

| Existing public table | Rows reported | Reuse |
|---|---:|---|
| canonical_entities | 82,485 | Stable biblical typed key/ID registry (word, lemma, lexeme, sense, concept, place, event, passage) |
| lexical_senses | 26,179 | Biblical-language senses; do NOT identify directly with a modern English WordNet synset |
| lexemes | 22,719 | Lexeme-level identity |
| lemmas | 22,171 | Lemma registry |
| lexical_roots | 2,637 | Attested roots; do not make roots carry whole-word English meanings |
| lemma_root_links | 6,504 | Attested root relationships |
| lexical_formations | 744 | Source-backed morphology/formation; distinct from inferred wordplay |
| lexical_connections | 2 | Literary/formal connections already exist; new candidate form matches go to offline graph |
| canonical concept registry: concepts | 1,349 | 1,344 are existing geospatial/natural-feature objects; only a few manually reviewed conceptual nodes |
| concept_properties | 8,864 | **Mostly geographic metadata**, not a ready-made physics property graph |
| concept_external_links | 2,119 | **Existing links are places**: OpenBible 1,342, Wikidata 655, Pleiades 122 |
| entity_relationships | 15,642 | Already typed and sourced; geography and roots dominate |
| source_releases | 10 | Existing publisher/edition/source registry |
| field_license_registry | 40 | Rights gate for ingest/export; restricted/unverified fields must stay out |
| lexical_senses | 26,179 | Preserve sense-level variation |
| semantic_annotations | 911 | Optional source-backed semantic features |
| hebrew_lxx_word_alignments | 9 | Exact alignments; much larger candidate lexical bridges are not token alignments |
| notes | 213 | Human/AI commentary is mutable and separate from immutable textual evidence |

Actual concept_properties keys are place_type, is_non_physical, tipnr_id, modern_name, identification_confidence, coordinates_lat_lon, wikidata_id, pleiades_id, active_eras. **Never read these keys as material/light/fire/biology facts**. Map existing IDs, especially existing Wikidata QIDs, to preserve identity and historical geography, but do not bulk-import all Wikidata property neighbors.

Observed entity_relationships types already include attested_at_place (8,745), derived_from_root (5,136), aramaic_cognate_of (581), spelling_or_form_variant_of (478), source_provided_lexical_equivalent (383), greek_transliteration_of (184), compound_part_of (109), a few narrative_parallel/possible_allusion/identified_as_in_passage. These are existing facts; **reuse them before generating more**.

Cloudflare read-only metadata showed deployed scripts named bibleresearch and bibleresearch-corpus. The remote live active release and D1.3 cache changes were **not inspected as source code**. Local checkout C:\Projects\BibleResearch-r10 remains authoritative.

## 3. Where each fact belongs

| Evidence | Authoritative home | New storage |
|---|---|---|
| Original words/lemmas/senses/versification | Existing Supabase canonical tables and pinned static corpus | Reuse identity index, no duplication |
| Grammar and syntactic occurrence statements | Existing R8/MACULA offline outputs | Small referenced graph edges if needed |
| Source-root/lexical-formation/translation relationships | Existing lexical tables + R9B | Reference provenance and witness IDs |
| Geographic Wikidata/Pleiades identity mappings | concept_external_links and concept_properties | Reuse; don't reinsert |
| Modern WordNet semantic classes and synsets | Pinned offline Open English WordNet | Immutable external-concepts/edges shards |
| Wikidata object/material/component properties | Pinned offline allowlisted property extract | Immutable external-assertions shards |
| ENVO/Uberon/PATO/ChEBI scientific ontology terms | Pinned, field-rights-approved offline source (later) | Immutable external-assertions, typed class/quality edges |
| Word-similarity candidates | Deterministic form index + source lexical form | Immutable candidate-edge shards |
| Cross-book/scene structural parallels | R8 statement signatures and pattern helper | Immutable pattern/evidence shards |
| Multihop recommendations and alternative proofs | Existing R9C offline mode + ranker | Immutable recommended-page/proof-page shards |
| User notes, reviewer commentary, preferences | Existing Supabase notes/review system | **Not** promoted into source evidence |
| Reviewer acceptance/rejection of uncertain external mappings | Existing notes/review pathway where appropriate | Optional very small private mapping review table, not bulk graph |

## 4. Logical offline tables (JSONL, not PostgreSQL migrations)

These are **logical record types**. Prefer existing R9B/R12 manifest conventions and IDs when a compatible structure already exists. Do not recreate separate graph entities that duplicate existing canonical IDs.

### R12_SOURCE_MANIFEST (one per externally pinned release)
- provider_key, provider_release, source_uri, retrieved_at, archive_sha256, license_spdx_or_text, attribution, field_rights_decisions, parent_releases, compiler_version, restricted_fields_excluded.
- Failing/unknown rights block data export. A set of successful API calls is not a reproducible source release; pin a dataset or saved response hashes.

### R12_EXTERNAL_CONCEPT (one per source ontology item)
- external_key: [provider]:[local_id], original labels per language, kind, source_release.
- Never use English gloss alone as identity. Reuse a linked biblical concept only after explicit mapping with status.

### R12_SENSE_CROSSWALK (ambiguous mappings stay ambiguous)
- biblical_entity_key, sense_id or lemma_id, source_edition, external_key, mapping_status verified/candidate/rejected/unresolved, mapping_method, lexical_support_ids, competing_candidates, provenance.
- One biblical sense may point to multiple provisional external synsets. Conversely the same synset may receive multiple biblical senses without declaring ancient synonyms.

### R12_EXTERNAL_ASSERTION (claim-level world knowledge)
- assertion_id, subject_external_key, predicate, object_external_key OR typed_value, scope and qualifiers, rank, publication/source_record_id, source_release_id, field_license_decision.
- Direction and time/conditions are essential: HAS_PART is not PART_OF; MADE_OF is not IDENTICAL_TO; a typical oil lamp is not every lamp in every era.

### R12_EVIDENCE_EDGE (merged into existing graph version)
- edge_id, subject_id, object_id, relation_type, direction, epistemic_layer, evidence_status, provenance pointer, passage_ids, source_token_ids, source_assertion_ids, mapping_status, scope, negation, limitations.
- Administrative identity joins may be displayed as verification steps but do not count as independent biblical attestations. Original and reverse traversal retain one canonical edge ID.

### R12_SCENE_SIGNATURE and R12_PATTERN
- scene_id, source_statement_ids, participant, action, object_class, attribute, location, quantity, statement_type, discourse/vision scope, unknown roles, edition mapping.
- PATTERN evidence holds exact matching typed feature IDs, IDF weights, source statement spans, group/lineage IDs, truncation/coverage metrics. Do not manufacture Hagar-specific motifs.

### R12_DISCOVERY_PATH
- path_id, anchor_id, target_id, ordered edge references, independent evidence groups, best path quality, discovery interest, contribution factors, weakest inferential status, limitations, score_version, coverage.

### R12_RECOMMENDATION_PAGE
- anchor_id -> up to 24 primary diverse recommendations; after the compact first page, retain cursors for lower-ranked exploratory candidates. Path and evidence bodies are separate lazy-loaded pages.
- A not_precomputed/partial result is **not** a proof that no biblical connection exists.

## 5. Exact acceptable evidence categories

- TEXTUAL — original scripture, verified edition/token reference and negation/speaker/verse scope.
- LINGUISTIC — trusted lexicographic/morphological source-attested relation with edition and licensing.
- EXTERNAL_WORLD — scientific, geographic, modern semantic/ontology property outside the Bible; never presented as a biblical statement.
- HYPOTHESIS — algorithmic shared spelling, conceptual class mapping, similarity, possible allusion or structural pattern; useful for exploration.
- RECEPTION — later commentarial linkage / historical interpretation, not independent Bible-author claim.
- USER_NOTE — dynamic commentary from existing notes, never part of immutable corpus claim.

Two-step example: Bible verse describing a lamp (TEXTUAL) -> mapping to a lamp object class (candidate or verified) -> external claim that an oil lamp uses fuel (EXTERNAL_WORLD). The resulting link to another verse about fire is HYPOTHESIS unless scripture directly establishes the interpretation.

## 6. Minimal asset contract and Worker reads

R12 versioned manifest namespaces: anchor map, adjacency, source metadata, external concepts, source assertions, proof edges, paths, recommendations, exploratory pages, text/display.

- Keep R8/R9/R11 active release intact. Candidate builds go to a separate local output tree.
- Key page by canonical anchor ID + release; prefixed fixed hash buckets and deterministic split pages with size limits. Reuse existing FNV helper and shard manifests rather than create a fresh sharder.
- Target ordinary click: bounded one-anchor + recommendation reads, no eager proof/book loads. Expanded proof retrieves only the selected path/evidence/verse pages.
- Store explicit coverage and truncation; return typed not_precomputed instead of silently loading old huge R11 assets.
- Cap cache and decode budget according to measured local D1.2/D1.3 Worker performance; local active CPU profile is more authoritative than Node elapsed time. No additional Cloudflare database service, D1, Durable Object, R2 or paid AI runtime required.
- The website and MCP use **identical** anchor, evidence and path IDs.

Cloudflare source: https://developers.cloudflare.com/workers/static-assets/ .

## 7. Proposed optional Postgres review schema — *not to execute now*

Only use a small private reviewed-mapping table if research notes and existing review structures cannot cover explicit corrections. Detailed SQL lives in [r12_review_schema_PROPOSAL.sql](r12_review_schema_PROPOSAL.sql).

Reasons to defer:
- Existing notes and canonical tables already support research without authentication.
- The main source graph is immutable and can be rebuilt from a versioned review JSONL file.
- A new exposed public table creates unnecessary security, API and maintenance complexity.
- Private review data cannot automatically be assumed publicly readable through MCP.

If introduced later, keep the table in a non-exposed schema, with RLS on, no PUBLIC/anon/authenticated privileges, source IDs and review provenance, and explicit authorized server-only import/export. Never grant an admin review endpoint to anonymous clients merely because the user currently works in single-user mode.

## 8. Validation and exact user-facing result

All new candidate algorithms are optional **offline** passes. The existing R9C engine remains the only graph traversal implementation. The readable source, tests and rights catalog live in this research directory.

Minimum phase-gate examples:
1. Adam vs dam: show matched original Hebrew consonants, normalized form, score and "not etymology" warning.
2. Spirit vs wind vs direction: show different original-language sense and occurrence attestations; no universal interchangeability.
3. Spring/well/Hagar: show word/sense links separately from participant/seeing/water source scene parallels.
4. Spirit/lampstand/seven lamps/seven eyes: reconstruct actual branching proof routes from biblical sources and preserve the Rev 1:20 lampstands/churches negative control.
5. External material-property bridge: show two independently sourced mappings and exact external assertion identity; label candidate, never biblical identification.
6. Low-quality generic-world property (THING/OBJECT, administrative geo code): do not dominate recommendations; pagination remains available where useful.
7. Each displayed assertion has provenance, rights, version and a truthful epistemic label, and supports selective lazy proof expansion.

Astra needs the current local code to wire these pieces; a Github main research file alone does not change the deployed BibleResearch service.

## 9. Read-only audit SQL

See [r12_schema_readonly_audit.sql](r12_schema_readonly_audit.sql) for count, source distribution and existing-property-metadata queries. It is safe for local investigation and **contains no DDL/DML**. Follow Supabase permission requirements and never expose service_role keys.
