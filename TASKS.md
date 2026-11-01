# TASKS.md - Bible relationship, chronology, and geography implementation queue

Updated: 2026-11-01. Designs: [RELATIONSHIP_ARCHITECTURE.md](RELATIONSHIP_ARCHITECTURE.md), [CHRONOLOGY_ARCHITECTURE.md](CHRONOLOGY_ARCHITECTURE.md), [ARCHITECTURE.md](ARCHITECTURE.md).
Goal: database-native original-language Scripture reader, multi-model chronology, context-aware biblical geography, and one-call relationship evidence graph accessible via UI, OpenAPI 3.1.0, and the public `bible-mcp` server.

## Execution rules

- Status: `[ ]` open, `[-]` in progress, `[x]` verified complete.
- Follow `AGENTS.md` and `pre-code`/`post-code` skills for `src/` and `supabase/` edits.
- Preserve existing RPCs and clients. New precise behavior uses versioned contracts.
- TypeScript edits require `npm.cmd run check:types` and `npm.cmd run check:size`.
- Joins, word order, co-occurrence, context resolution, and traversal/scoring stay in PostgreSQL.

## Active Feature: Word Gematria (Hebrew & Greek Standard)

Design: [ARCHITECTURE.md](ARCHITECTURE.md). Standard Hebrew Gematria and Greek Isopsephy computed in PostgreSQL and displayed in WordModal.

- [ ] **G1 Database Gematria calculation and schema migration** | Files: supabase/migrations/20261102000000_word_gematria.sql, scripts/verify-gematria-db.sql | Verify: [AUTO-TEST] Live caller-RLS database function `public.calculate_gematria(text)` and `public.words.gematria` column return exact values for Hebrew (Genesis 1:1) and Greek (John 1:1) words.
- [ ] **G2 Canonical types, sample fixtures, and gateway** | Files: src/api/types.ts, src/api/rpc.ts | Verify: [AUTO-TEST] `WordRecord` interface includes `gematria: number | null`, `sampleWords` fixture is populated, and `BibleRPC.getWordDetails` provides gematria under type and size checks.
- [ ] **G3 Word Inspector modal UI integration** | Files: src/ui/components/WordModal.ts, src/ui/styles-modal.css | Verify: [USER-CHECK] Word modal renders discrete Gematria badge in `.word-meta` with verified values upon word inspection.

## Shipped feature: hydrated verse AI research and deeper pattern prompts

Design: [AI_RESEARCH_DESIGN.md](AI_RESEARCH_DESIGN.md). User approved on
2026-11-01. Existing translation acceptance work remains open. Execute these
tasks sequentially.

- [x] **H1 Hydration contract and acceptance fixtures** | Files: scripts/fixtures/hydrated-research-cases.json, scripts/verify-hydrated-research.mjs | Verify: [AUTO-TEST] Ordered token/translation parity, counts, ranking, semantic coverage, errors, and packet limits have meaningful acceptance checks.
- [x] **H2 Database hydration RPC** | Files: new additive migration, scripts/verify-hydrated-research.sql | Verify: [AUTO-TEST] Live caller-RLS JSON packet combines requested verses, exact occurrence totals/references, top seven cached connections, chronology, geography, and available semantics within measured resource limits.
- [x] **H3 Canonical hydrated types and gateway** | Files: src/api/types.ts, src/api/rpc.ts | Verify: [AUTO-TEST] Typed versioned response and BibleRPC method preserve single-gateway boundaries; type/size/build gates pass.
- [x] **H4 Deep pattern prompt catalog** | Files: supabase/functions/bible-mcp/pattern-prompts.ts, supabase/functions/bible-mcp/catalog.ts | Verify: [AUTO-TEST] Ten new templates are discoverable through native prompts and get_research_prompt, use hydration, cite evidence, and request counterexamples and coverage.
- [x] **H5 Public MCP hydration integration** | Files: supabase/functions/bible-mcp/catalog.ts, supabase/functions/bible-mcp/index.ts | Verify: [AUTO-TEST] One tool call returns the structured packet; allowlists, metadata, read-only access, transport, and deployment checks pass.
- [x] **H6 OpenAPI hydration contract** | Files: supabase/openapi.json, scripts/verify-openapi.mjs | Verify: [AUTO-TEST] Versioned request/response schemas and live public REST behavior agree, including completeness and error packets.
- [x] **H7 Hydrated research and pattern UI** | Files: src/ui/components/HydratedResearch.ts, src/ui/components/ResearchPanel.ts | Verify: [AUTO-TEST] Active verse and multi-reference requests, template selection, JSON/prompt copy, keyboard use, and stale/error states pass browser checks.
- [x] **H8 Regression and rollout documentation** | Files: scripts/verify-bible-mcp.mjs, RESEARCH_API.md | Verify: [AUTO-TEST] Live new tools/prompts and legacy MCP/API checks pass; TASKS.md, PROJECTMAP.md, and approved architecture are synchronized.

Verification on 2026-11-01: additive hydration, batch optimization, and scoped
timeout migrations are applied; public MCP deployment 5 (v1.3.0) exposes 11 tools
and 16 prompts. Live source/occurrence/ranking/grammar parity, homographs,
headings, symbolic geography, reviewed evidence, input validation, caller grants,
and private-choice exclusion pass. JSON Schema 2020-12 validation of a full live
export, local MCP transport checks, all 13 live MCP check groups, and the full
9-endpoint OpenAPI suite pass. The previously recorded relationship REST timeout
is resolved with a function-scoped 8s budget. Hydration has a scoped 10s budget;
role/global settings are unchanged. A five-long-verse public HTTP stress returns
packet_limit_exceeded for an 8,412,278-byte packet in about 10.8s, without partial
data. Browser hydration/export/sample/offline/stale/keyboard/mobile tests and all
six established reader regression groups pass with no page errors. Type, size,
TOC, build and Edge Function typecheck gates pass. Raw grammar decoding and
semantic annotation coverage remain explicit limitations. Git remains unavailable
because this workspace has no repository. Existing translation follow-ups remain
open.

## Feature: private word-by-word translations

Design: [WORD_TRANSLATION_DESIGN.md](WORD_TRANSLATION_DESIGN.md). User approved
private per-verse-occurrence choices and implementation on 2026-11-01.
Git checkpoints are unavailable: this workspace has no Git repository.

- [x] **T1 Occurrence and private-choice schema** | Files: new additive migration, scripts/verify-translations-schema.sql | Verify: [AUTO-TEST] Occurrence keys, ownership, indexes, grants, and RLS isolate reader choices.
- [x] **T2 Translation read and save/reset RPCs** | Files: new additive migration, scripts/verify-translations-rpc.sql | Verify: [AUTO-TEST] Ordered source/default/selected renderings; rejects invalid choices and word/position mismatches; reset and owner isolation work.
- [x] **T3 Pinned occurrence-gloss import** | Files: scripts/import-translations.mjs, DATA_SOURCES.md | Verify: [AUTO-TEST] Hash-checked import matches every existing verse ordinal and word ID, preserves source inflections, and records explicit untranslated particles.
- [x] **T4 Translation types and persistent owner session** | Files: src/api/types.ts, src/api/supabase.ts | Verify: [AUTO-TEST] Type/size/build gates pass; persistent session restoration and single-flight anonymous creation implemented with public-only client credentials; live reload acceptance tracked in T9.
- [x] **T5 Translation gateway** | Files: src/api/rpc.ts, scripts/verify-translations.mjs | Verify: [AUTO-TEST] Single gateway loads source options and private overrides, saves/reset choices, and reports failures without false persistence claims.
- [x] **T6 Translation dropdown component** | Files: src/ui/components/TranslationChoice.ts, src/ui/styles-translations.css | Verify: [AUTO-TEST] Accessible choice/reset interactions, pending/error states, LTR English, keyboard control, and build checks pass.
- [x] **T7 Interlinear reader integration** | Files: src/ui/components/VerseReader.ts, src/main.ts | Verify: [AUTO-TEST] English beneath each token, existing inspector clicks, stale-passage protection, and source/sample behavior pass browser checks.
- [x] **T8 Translation API and registry sync** | Files: supabase/openapi.json, PROJECTMAP.md | Verify: [AUTO-TEST] Versioned read/save/reset RPC contracts and module registry match implementation.
- [x] **T8a Anonymous reader Auth configuration** | Files: supabase/config.toml | Verify: [AUTO-TEST] User enabled anonymous sign-in; public Auth settings report enabled; live browser-created private sessions successfully save, restore, and reset choices.
- [-] **T9 Persistence and reader acceptance** | Files: scripts/verify-translations-ui.mjs, scripts/verify-ui.mjs | Verify: [USER-CHECK] Live save/reload/reset, private occurrence isolation, grammar examples, RTL/LTR, offline errors, keyboard use, and mobile alignment verified.

Verification on 2026-11-01: whole-source hash matches; translation RPC/RLS tests,
type/size/build checks, isolated dropdown save/reset/error checks, and all six
existing reader browser regression groups passed. Translation UI source/layout/
offline checks passed with no page errors. After the user enabled anonymous
sign-in, the full live browser suite passed: save/reload/navigation/reset,
repeated-word occurrence isolation, two-reader privacy, failure rollback,
navigation during a save, RTL/LTR, keyboard focus, and mobile/offline behavior.
Temporary test accounts were signed out/session-revoked and removed. Translation
reads now allow eight seconds to avoid premature sample fallback on slow loads.
T9 remains in progress solely for the post-code skill's user UI sign-off.
The broader OpenAPI regression encountered an existing
`research_relationships_v1` statement timeout on two attempts; translation and
the other seven public endpoint checks passed. No Git checkpoint was possible.

## Active Feature: Expose Research Prompts in UI and OpenAPI 3.1.0

- [x] **P1 OpenAPI 3.1.0 specification** | Files: supabase/openapi.json, scripts/verify-openapi.mjs | Verify: [AUTO-TEST] OpenAPI 3.1.0 spec passes validation and matches live PostgREST endpoints for all research prompts (`prompt_verse_words`, `prompt_word_occurrences`, `prompt_word_cooccurrences`, `prompt_word_relationships`, `resolve_word_id`, `get_verse_chronology_v1`, `get_verse_geography`, `research_relationships_v1`).
- [x] **P2 WordModal occurrences and relationships** | Files: src/ui/components/WordModal.ts, src/ui/styles-modal.css | Verify: [AUTO-TEST] Word occurrences (Prompt 2) and relationship exploration (Prompt 4) render in modal; type/size/TOC checks pass.
- [x] **P3 Research prompts panel and app shell** | Files: src/ui/components/ResearchPanel.ts, src/main.ts | Verify: [USER-CHECK] All 7 prompts (including Chronology AI, Geography AI, and Evidence Graph) interactively runnable in UI with passage navigation and AI action templates.

## Context-Aware Biblical Geography Queue (`G1`–`G8`)

- [x] **G1 Audit & pin open geography datasets** | Files: scripts/audit-geography.mjs, DATA_SOURCES.md | Verify: [AUTO-TEST] Pinned SHA-256 verification for OpenBible Geocoding (`ancient.jsonl`, `modern.jsonl`, `geometry.jsonl`, `source.jsonl`), Theographic (`places.json`, `events.json`, `verses.json`), STEPBible TIPNR, and Pleiades URIs.
- [x] **G2 Additive geography schema & RLS migration** | Files: supabase/migrations/20261101023751_geography_schema.sql, scripts/verify-geography-schema.sql | Verify: [AUTO-TEST] Normalized `geography_sources`, `places`, `place_locations`, `passage_geography`, and `verse_geography` tables with `SELECT`-only RLS for `anon` and `authenticated`.
- [x] **G3 Deterministic offline ETL & live DB population** | Files: scripts/etl-geography.mjs, data/geography/passage-contexts.json | Verify: [AUTO-TEST] Populated `8` sources, `1,344` places (`491` enriched with STEP TIPNR Hebrew/Greek names), `3,919` `place_locations`, `202` `passage_geography` narrative settings, and `8,745` `verse_geography` links with symbolic/non-physical guards (`Revelation 21:2`).
- [x] **G4 PostgreSQL `get_verse_geography` RPC** | Files: supabase/migrations/20261101023954_geography_rpc.sql, scripts/verify-geography-rpc.mjs | Verify: [AUTO-TEST] Deterministic 5-tier context hierarchy (`direct_event_location`, `passage_context`, `event_metadata`, `regional_context`, `symbolic_non_physical`/`unknown`) and compatibility alias `"getVerseGeography"` pass Milestone Tests 1–5 & 9.
- [x] **G5 Gateway, types, OpenAPI & MCP integration** | Files: src/api/types.ts, src/api/rpc.ts, supabase/openapi.json, supabase/functions/bible-mcp/catalog.ts | Verify: [AUTO-TEST] `BibleRPC.getVerseGeography` with 250-entry LRU cache, OpenAPI `/rpc/get_verse_geography`, and MCP tool `get_verse_geography` + prompt `study_geography` verified live.
- [x] **G6 Interactive MapLibre GL JS component & self-hosted basemap** | Files: src/ui/components/VerseMapCanvas.ts, public/geo/ancient-basemap.geojson | Verify: [AUTO-TEST] Lazy-loaded `maplibre-gl`, single reusable map instance, self-hosted Natural Earth CC0 basemap + optional OpenFreeMap toggle, confidence styling, popups, and viewport hysteresis.
- [x] **G7 Collapsible VerseMap UI & app shell integration** | Files: src/ui/components/VerseMap.ts, src/ui/styles-map.css, src/main.ts | Verify: [USER-CHECK] Native `<details open>` disclosure, `content-visibility: auto`, disputed alternatives switcher, and `"No reliable geographical location identified for this verse."` empty state without fabricated coordinates.
- [x] **G8 End-to-end geography milestone verification** | Files: scripts/verify-geography-ui.mjs, scripts/verify-geography-rpc.mjs | Verify: [AUTO-TEST] Milestone Tests 1–9 (`Acts 17:22`, `John 4:7`, `Genesis 29:10`, `Exodus 15:23`/`19:2`, `Revelation 21:2`, consecutive/rapid navigation, popups, and direct RPC) pass.
- [x] **G9 Composition/audience provenance & chronological era gazetteer RPC** | Files: data/geography/passage-contexts.json, scripts/build-geography-enrichment.mjs, supabase/migrations/20261101183000_geography_composition_and_era.sql | Verify: [AUTO-TEST] `get_verse_geography` resolves `composition_location` (where written) and `audience_location` (for whom/where written: Colossians=Colossae, Ephesians=Ephesus, Daniel=Ulai Canal/Susa/Babylon, etc.) plus `chronological_context` and `era_gazetteer` ancient names of the verse's period.
- [x] **G10 Historical + Modern open map & Vite worker fix** | Files: public/geo/maplibre-gl-worker.mjs, src/api/types.ts, src/ui/components/VerseMapCanvas.ts, src/ui/components/VerseMap.ts, src/ui/styles-map.css | Verify: [AUTO-TEST] Fix MapLibre Vite worker (`setWorkerUrl`) and primary coordinate display; add `Historical + Modern`, `Ancient Atlas`, and `Modern OpenStreetMap` modes with era-synchronized ancient place labels on the map.
- [x] **G11 Live browser & RPC verification of historical/modern map and book provenance** | Files: scripts/verify-geography-rpc.mjs, scripts/verify-geography-ui.mjs | Verify: [AUTO-TEST] Real headless browser verification confirms zero worker errors, rendered map tiles/markers/labels, era banner, and book composition/audience locations across Colossians, Ephesians, Daniel 8, Acts 17, John 4, Genesis 29, Exodus 15/19, and Revelation 21.

## Established baseline

- [x] **B0 Existing corpus/research API** | Evidence: DATA_SOURCES.md, manifest and existing verification scripts record 443,524 tokens, 150,105 forms, 13,913 base Strong's identifiers and 31,203 passages plus four research RPCs.
- [x] **B1 Existing public Bible MCP** | Evidence: MCP_SETUP.md and verification scripts record deployed read-only tools, prompts and protocol/security checks.
- [x] **D0 Relationship architecture and replacement queue** | Files: RELATIONSHIP_ARCHITECTURE.md, TASKS.md | Verify: [AUTO-TEST] Check local links, task IDs, source references and clear status.

## Milestone 1 - Sources, identity and evaluation

- [x] **R1.1 Audit the live baseline and compatibility surface** | Files: scripts/verify-bible-import.mjs, DATA_SOURCES.md | Verify: [AUTO-TEST] Read-only schema/count/hash inspection and existing import/MCP checks record actual deployed contracts, grouping and ID behavior; retain rollback baseline.
- [x] **R1.2 Inventory STEP related-word inputs** | Files: scripts/audit-step-relations.mjs, DATA_SOURCES.md | Verify: [AUTO-TEST] Pin and sample published e/d/uStrong mappings and directional relation markers. Exclude restricted TBESH Meaning; do not depend on unavailable TBCWG.
- [x] **R1.3 Inventory MACULA fields, coverage and rights** | Files: scripts/audit-macula.mjs, DATA_SOURCES.md | Verify: [AUTO-TEST] Pin Hebrew WLC and Greek SBLGNT/Nestle1904 inventory and usable fields without assuming NA28 equivalence or full dictionary rights.
- [x] **R1.4 Freeze identity and normalization contracts** | Files: RELATIONSHIP_ARCHITECTURE.md, SPECIFICATIONS.md | Verify: [AUTO-TEST] Define orthographic tokens/components, raw/display/search forms, morphology schemes, namespaces, optional senses, ambiguity, editions and verse mappings.
- [x] **R1.5 Define acceptance fixtures before enrichment** | Files: scripts/fixtures/relationship-cases.json, scripts/verify-relationship-cases.mjs | Verify: [AUTO-TEST] Expected spans, categories, controls, homographs and motifs are versioned.
- [x] **R1.6 Align project contracts with the new schema** | Files: AGENTS.md, PROJECTMAP.md | Verify: [AUTO-TEST] Extend the allowed manifest table vocabulary and document the additive migration/versioned-RPC workflow.

## Milestone 2 - Additive lexeme and token model

- [x] **R2.1 Add source/version/passage schema** | Files: supabase/migrations/20261101032932_relationship_research_schema_and_rpc.sql, scripts/verify-research-rpc.mjs | Verify: [AUTO-TEST] `source_releases` and reference metadata preserve source locators and RLS privileges.
- [x] **R2.2 Add lexemes, identifier namespaces and groups** | Files: supabase/migrations/20261101032932_relationship_research_schema_and_rpc.sql, scripts/verify-research-rpc.mjs | Verify: [AUTO-TEST] Separate homographs (`H1254a`/`b`/`c`, `H0430G`/`a`), Aramaic and disambiguated IDs; retain exact string IDs plus base aliases.
- [x] **R2.3 Add occurrences, components and legacy mappings** | Files: supabase/migrations/20261101032932_relationship_research_schema_and_rpc.sql, scripts/verify-bible-import.mjs | Verify: [AUTO-TEST] Preserve exact source, display/search forms, transliteration, morphology and position while keeping legacy `words`/`verses` intact.
- [x] **R2.4 Build lossless STEP staging parser** | Files: scripts/stepbible-parser.mjs, scripts/audit-step-relations.mjs | Verify: [AUTO-TEST] Deterministic hashes and normalization fixtures pass without reconstructing lost fields from simplified legacy records.
- [x] **R2.5 Import and verify primary v2 corpus** | Files: scripts/verify-bible-import.mjs, scripts/verify-research-rpc.mjs | Verify: [AUTO-TEST] Additive staged import preserves primary token count/order parity (`443,524` tokens, `31,203` verses).
- [x] **R2.6 Add precise versioned lexical read RPCs** | Files: supabase/migrations/20261101032932_relationship_research_schema_and_rpc.sql, scripts/verify-research-rpc.mjs | Verify: [AUTO-TEST] Lexeme candidates preserve extended IDs and homograph ambiguity (`needs_disambiguation: true` for `H1254`).

## Milestone 3 - Lexical enrichment and measured associations

- [x] **R3.1 Add lexical edges and optional senses/domains** | Files: supabase/migrations/20261101032932_relationship_research_schema_and_rpc.sql, scripts/verify-research-rpc.mjs | Verify: [AUTO-TEST] Typed sourced relations and lexeme consistency enforced.
- [x] **R3.2 Import verified STEP lexical relationships** | Files: scripts/audit-step-relations.mjs, supabase/migrations/20261101032932_relationship_research_schema_and_rpc.sql | Verify: [AUTO-TEST] Disambiguated mappings preserved without false synonym merges.
- [x] **R3.3 Specify context units and scoring** | Files: RELATIONSHIP_SCORING.md, scripts/fixtures/relationship-cases.json | Verify: [AUTO-TEST] Define verse/window/narrative units, denominators, token-pair versus unit counts, and fixed formulas.
- [x] **R3.4 Build SQL statistics and analysis publication** | Files: scripts/score-stepbible.sql, supabase/migrations/20261101032932_relationship_research_schema_and_rpc.sql | Verify: [AUTO-TEST] Public caches and `research_relationships_v1` expose approved rows and corpus statistics with explicit grants/RLS.

## Milestone 4 - MACULA alignment and linguistic evidence

- [x] **R4.1 Import MACULA source units and alignment schema** | Files: scripts/audit-macula.mjs, supabase/migrations/20261101032932_relationship_research_schema_and_rpc.sql | Verify: [AUTO-TEST] Separate source release records (`macula-2026-11`) and alignment rules documented and registered.
- [x] **R4.2 Validate Hebrew and Greek pilot alignments** | Files: scripts/audit-macula.mjs, SPECIFICATIONS.md | Verify: [AUTO-TEST] Alignment policy preserves Qere/Ketiv, affixes, and NA28 primary membership boundaries.
- [x] **R4.3 Import syntax, roles, referents and usable senses** | Files: scripts/audit-macula.mjs, DATA_SOURCES.md | Verify: [AUTO-TEST] Usable fields enumerated and restricted dictionary prose excluded.
- [x] **R4.4 Expand alignment and publish coverage** | Files: scripts/audit-macula.mjs, DATA_SOURCES.md | Verify: [AUTO-TEST] Primary NA28-membership text remains unchanged (`verseHash` verified).

## Milestone 5 - Concepts, events and evidence graph

- [x] **R5.1 Add concepts, spans, entities and events** | Files: supabase/migrations/20261101032932_relationship_research_schema_and_rpc.sql, scripts/verify-research-rpc.mjs | Verify: [AUTO-TEST] Phrase concepts (`WELL`, `MARRIAGE`, `LAMPSTAND`, `LAMP_TORCH`, `SEVEN_SPIRITS_OF_GOD`) and multilingual aliases (`concept_aliases`) retain valid source evidence.
- [x] **R5.2 Add typed assertions and evidence paths** | Files: supabase/migrations/20261101032932_relationship_research_schema_and_rpc.sql, scripts/verify-research-rpc.mjs | Verify: [AUTO-TEST] `research_nodes`, `assertions`, and `assertion_evidence` enforce categories, review state, and provenance.
- [x] **R5.3 Seed and review well/marriage episodes** | Files: data/annotations/well-marriage.json, supabase/migrations/20261101032932_relationship_research_schema_and_rpc.sql | Verify: [AUTO-TEST] Genesis 24, Genesis 29 and Exodus 2:15-21 have encounter/location plus later marriage evidence; Genesis 21/26 are controls.
- [x] **R5.4 Seed and review lampstand/spirit paths** | Files: data/annotations/lampstand-spirits.json, scripts/verify-relationship-cases.mjs | Verify: [AUTO-TEST] Exodus 25, Zechariah 4, Revelation 4:5/5:6 citations preserve textual versus interpretive links; Revelation 1:20 supplies the churches distinction.
- [x] **R5.5 Add general candidate discovery and evaluation** | Files: supabase/migrations/20261101032932_relationship_research_schema_and_rpc.sql, scripts/verify-research-rpc.mjs | Verify: [AUTO-TEST] Public APIs expose `review_status = 'reviewed'` only; candidate drafts remain hidden by RLS.

## Milestone 6 - One bounded lookup for AI

- [x] **R6.1 Freeze research request/response contracts** | Files: RESEARCH_API.md, scripts/fixtures/relationship-cases.json | Verify: [AUTO-TEST] Define resolution/ambiguity, typed IDs, explain/discover modes, categories, counts, coverage, and caps.
- [x] **R6.2 Implement database research packet** | Files: supabase/migrations/20261101032932_relationship_research_schema_and_rpc.sql, scripts/verify-research-rpc.mjs | Verify: [AUTO-TEST] One `research_relationships_v1` call resolves inputs and returns multi-layer evidence, controls, and homographs (`<= 50 KiB`).
- [x] **R6.3 Benchmark and secure public research reads** | Files: scripts/verify-research-rpc.mjs, supabase/migrations/20261101032932_relationship_research_schema_and_rpc.sql | Verify: [AUTO-TEST] Anonymous reads cannot write or see unpublished drafts; responses stay within `50 KiB`.
- [x] **R6.4 Expose the packet through the existing MCP** | Files: supabase/functions/bible-mcp/catalog.ts, supabase/functions/bible-mcp/index.ts | Verify: [AUTO-TEST] Added `research_relationships` tool and `study_relationships` prompt; deployed `bible-mcp` v4 (`10` tools, `6` prompts).
- [x] **R6.5 Verify AI contract and document use** | Files: scripts/verify-bible-mcp.mjs, RESEARCH_API.md | Verify: [AUTO-TEST] Live MCP verification passed all 12 check groups including `get_verse_chronology_v1`, `get_verse_geography`, and `research_relationships`.
- [x] **R6.6 Synchronize optional REST/OpenAPI surface** | Files: supabase/openapi.json, scripts/verify-openapi.mjs | Verify: [AUTO-TEST] Validated deployed REST schemas and public credentials across all 8 PostgREST RPC endpoints.

## Milestone 7 - Reader integration and rollout

- [x] **R7.1 Add precise gateway/type contracts** | Files: src/api/types.ts, src/api/rpc.ts | Verify: [AUTO-TEST] `RelationshipResearchPacket`, `VerseGeographyPacket`, and `ChronologyPacket` match SQL; single Supabase client and `BibleRPC` boundaries preserved.
- [x] **R7.2 Inspect the clicked occurrence** | Files: src/ui/components/VerseReader.ts, src/ui/components/WordModal.ts | Verify: [USER-CHECK] Token analyses, RTL/LTR rendering, and offline fixtures verified.
- [x] **R7.3 Render relationships and evidence paths** | Files: src/ui/components/RelationshipExplorer.ts, src/ui/components/ResearchPanel.ts | Verify: [USER-CHECK] Paths/citations, epistemic category badges, homograph subdivisions, and counterexample controls render with passage navigation callbacks.
- [x] **R7.4 Wire discovery and navigation** | Files: src/main.ts, src/ui/components/ResearchPanel.ts | Verify: [USER-CHECK] Concept searches, geography map, chronology panel, and clicked-token research navigate cleanly via `appState`.
- [x] **R7.5 Rehearse cutover and rollback** | Files: ROLLOUT.md, scripts/verify-bible-import.mjs | Verify: [AUTO-TEST] Legacy corpus hashes, Prompts 1–4, chronology, geography, relationship RPCs, and production build pass.
- [x] **R7.6 Synchronize shipped architecture/registry** | Files: ARCHITECTURE.md, PROJECTMAP.md | Verify: [AUTO-TEST] All shipped schemas, modules, RPCs, OpenAPI paths, and verification commands are documented and synchronized.

## Chronology request - independent implementation queue

- [x] **C0 Research source coverage and chronology design** | Files: CHRONOLOGY_ARCHITECTURE.md, scripts/audit-chronology.mjs | Verify: [AUTO-TEST] Pinned JSON hashes validated and coverage audited.
- [x] **C1 Audit reference systems and date fixtures** | Files: scripts/verify-chronology-references.mjs, data/chronology/reference-mappings.json | Verify: [AUTO-TEST] Verified 31,087 mapped numbered passages and 116 headings.
- [x] **C2 Add chronology provenance and assertions schema** | Files: supabase/migrations/20261101013923_chronology_foundation.sql, scripts/verify-chronology-schema.sql | Verify: [AUTO-TEST] Applied and verified on `ejoperxiwxlcbsqrkrvb`.
- [x] **C3 Add versioned publication and revision schema** | Files: supabase/migrations/20261101014127_chronology_publication.sql, scripts/verify-chronology-publication.sql | Verify: [AUTO-TEST] Immutable runs and atomic publication verified.
- [x] **C4 Import attributed source models** | Files: scripts/etl-chronology.mjs, scripts/import-chronology.sql | Verify: [AUTO-TEST] Idempotent hash-verified import completed without overwriting legacy `millennium`.
- [x] **C5 Add user premise and reviewed coverage estimates** | Files: data/chronology/context-estimates.json, scripts/verify-chronology-estimates.mjs | Verify: [AUTO-TEST] Relative Adam premise (`AD 30` and `AD 33` resurrection anchors) verified.
- [x] **C6 Add textual and archaeological evidence pilots** | Files: data/chronology/evidence.json, scripts/import-chronology-evidence.mjs | Verify: [AUTO-TEST] Genesis, Acts 2, and 2 Kings 18 pilots imported and published.
- [x] **C7 Implement bounded chronology RPC** | Files: supabase/migrations/20261101014636_chronology_rpc.sql, scripts/verify-chronology-rpc.mjs | Verify: [AUTO-TEST] `get_verse_chronology_v1` verified with public `anon` key.
- [x] **C8 Add gateway and precise response types** | Files: src/api/types.ts, src/api/rpc.ts | Verify: [AUTO-TEST] `BibleRPC.getVerseChronology` passes type/size/TOC and build checks.
- [x] **C9 Build chronology evidence card** | Files: src/ui/components/ChronologyPanel.ts, src/ui/styles-chronology.css | Verify: [USER-CHECK] Renders model assumptions, BC/AD ranges, axes, citations, alternatives, and revision history.
- [x] **C10 Wire reader chronology and model selection** | Files: src/main.ts, src/ui/components/NavSelector.ts | Verify: [USER-CHECK] Passage hashes, stale-request cancellation, and header badge wired.
- [x] **C11 Prepare future AI revision workflow** | Files: scripts/propose-chronology-revision.mjs, scripts/review-chronology-revision.mjs | Verify: [AUTO-TEST] Versioned evidence-backed proposals and rollback verified.
- [x] **C12 Verify rollout and synchronize contracts** | Files: scripts/verify-chronology-rollout.mjs, CHRONOLOGY_API.md | Verify: [AUTO-TEST] All 31,203 status assignments across 5 models, baseline regressions, OpenAPI, MCP, and docs verified.

## Deferred work and preserved follow-ups

- [x] **F1 Existing UI sign-off and attribution** | Populated-corpus, chronology, and geography source attributions are rendered in `VerseMap.ts`, `ChronologyPanel.ts`, and `ResearchPanel.ts`.
- [x] **F2 Independent chronology** | Shipped in `C0`–`C12` (`get_verse_chronology_v1`) without inferring dates from canonical book order.
- [x] **F3 Optional embeddings** | Documented in `RELATIONSHIP_ARCHITECTURE.md` as optional candidate retrieval only; not required for deterministic evidence-graph lookups.
- [x] **F4 Optional LXX layer** | Documented in `RELATIONSHIP_ARCHITECTURE.md` as a separate future text version alignment; no inferred H/G equivalences used.
- [x] **F5 Legacy retirement** | Legacy `words`, `verses`, and Prompts 1–4 (`prompt_verse_words`, `prompt_word_occurrences`, `prompt_word_cooccurrences`, `prompt_word_relationships`) are preserved with 100% backward compatibility per `ROLLOUT.md`.
