# TASKS.md - Bible relationship, chronology, and geography implementation queue

Updated: 2026-11-05 (UX proposal added; existing queue statuses preserved). Designs: [UX_STRATEGY.md](UX_STRATEGY.md), [RELATIONSHIP_ARCHITECTURE.md](RELATIONSHIP_ARCHITECTURE.md), [CHRONOLOGY_ARCHITECTURE.md](CHRONOLOGY_ARCHITECTURE.md), [ARCHITECTURE.md](ARCHITECTURE.md).
Goal: database-native original-language Scripture reader, multi-model chronology, context-aware biblical geography, and one-call relationship evidence graph accessible via UI, OpenAPI 3.1.0, and the public `bible-mcp` server.

## Execution rules

- Status: `[ ]` open, `[-]` in progress, `[x]` verified complete.
- Follow `AGENTS.md` and `pre-code`/`post-code` skills for `src/` and `supabase/` edits.
- Preserve existing RPCs and clients. New precise behavior uses versioned contracts.
- TypeScript edits require `npm.cmd run check:types` and `npm.cmd run check:size`.
- Joins, word order, co-occurrence, context resolution, and traversal/scoring stay in PostgreSQL.

## Active Feature: Deterministic Relationship Discovery Engine (Foundations)

Approved by user 2026-11-05. Deliverables & Plan: [AUDIT_REPORT.md](.artifacts/AUDIT_REPORT.md).
Canonical data layer serving Web and MCP without AI-generated relationships.

- [x] **FOUNDATION-01 Apply Safe Foundational Indexes & GIN Optimization** | Files: supabase/migrations/20261105175000_foundational_indexes_and_perf.sql | Verify: [AUTO-TEST] Missing foreign key indexes added, duplicate index dropped, GIN occurrence optimization verified via verify-hydrated-research.mjs and verify-bible-mcp.mjs.
- [x] **FOUNDATION-02 Create Canonical Books Metadata Table & RPC** | Files: supabase/migrations/20261105180000_canonical_books.sql, src/api/types.ts, src/api/rpc.ts | Verify: [AUTO-TEST] Table public.books created with 66 canonical books (testaments, original languages, chapter counts, standard/STEP/Theographic abbreviations), RLS enabled, get_bible_books_v1 RPC created and verified.
- [x] **FOUNDATION-03 Ingest Corpus-Wide STEP Lexemes & Disambiguation** | Files: scripts/import-lexemes.mjs, supabase/migrations/20261105183000_corpus_lexemes_schema.sql | Verify: [AUTO-TEST] Pinned STEP TBESH/TBESG lexicon ingested into public.lexemes for all 13,913 Strong's numbers with homograph subdivisions preserved; get_verse_research_v1 populates lexeme_candidates for any biblical passage.

## Active Feature: Canonical Biblical Lexical & Evidence Database

Approved by user 2026-11-05. Blueprint: [ARCHITECTURE.md](ARCHITECTURE.md) §3.
Additive normalized schema separating surface word forms, canonical lemmas, lexical entries, documented roots, lexical senses, translation glosses, versification mappings, syntax/morphology, external concept properties/links, and provenance-complete entity relationships—with zero AI sense assignment or relationship generation.

- [x] **LEX-01 Security/Licensing Remediation & Canonical Lexical/Evidence Schema** | Files: supabase/migrations/20261105230000_canonical_lexical_and_evidence_schema.sql, scripts/import-lexemes.mjs | Verify: [AUTO-TEST] Revoke public/anon execute on ingest_lexemes_batch_v1, purge restricted TBESH Meaning notes from public.lexemes, create normalized editions/versification/lemmas/word_form_lemmas/roots/senses/morphemes/syntax/annotations/concept_properties/entity_relationships tables with FK indexes, provenance constraints, and SELECT-only RLS; pass Supabase security advisors.
- [-] **LEX-02 Deterministic Corpus & Provenance ETL** | Files: scripts/import-canonical-lexical-db.mjs | Verify: [AUTO-TEST] Reproducibly populate source_editions, edition_passages, versification_mappings, lemmas, lexeme_identifiers, word_form_lemmas (all 150,105 word forms), lexical_roots, lemma_root_links, lexical_senses (licensed STEP + Abbott-Smith), token_morphemes, syntax_nodes/edges (TAGNT Conjoin word), semantic_annotations, concept_properties/links, research_nodes, and entity_relationships with 100% provenance fields.
- [ ] **LEX-03 Seven Deterministic Lookup PostgreSQL RPCs** | Files: supabase/migrations/20261105233000_canonical_lookup_rpcs.sql | Verify: [AUTO-TEST] Deploy and verify caller-RLS lookup_word_to_lemma_senses_v1, lookup_lemma_occurrences_v1, lookup_lemma_root_relatives_v1, lookup_lemma_english_glosses_v1, lookup_passage_tokens_syntax_v1, lookup_concept_properties_v1, and lookup_entity_relationships_v1 over SQL and PostgREST.
- [ ] **LEX-04 Canonical TypeScript Gateway & OpenAPI 3.1.0 Exposure** | Files: src/api/lexical-types.ts, src/api/types.ts, src/api/rpc.ts, supabase/openapi.json | Verify: [AUTO-TEST] Expose all 7 lookup contracts via BibleRPC and OpenAPI 3.1.0 while keeping check:types, check:size (max 450 lines/file, max 80 lines/section, exact @toc), and build green.
- [ ] **LEX-05 Validation Checks, Invariant Test Suite & Regression Gate** | Files: scripts/verify-canonical-lexical-db.mjs, PROJECTMAP.md | Verify: [AUTO-TEST] End-to-end verification of modeling invariants (form != lemma != root != sense != gloss, non-synonymous roots, provenance completeness, RLS write denial, zero TBESH Meaning leakage), all 7 lookup APIs, and full existing regression suites (books, hydrated research, relationship RPC, public MCP).

## Proposed feature: complete UX refresh

Requested 2026-11-05. Design: [UX_STRATEGY.md](UX_STRATEGY.md).
**Implementation authorized 2026-11-05**, including visible word-rendering ranges,
direct place-name map links, and event timelines with cross-book connections.
Target: a passage-centered reader that makes word
meaning and typed connections understandable immediately, with complete English
verse previews on hover/focus and equivalent explicit touch/keyboard actions.

Proposed hierarchy: reading area + persistent word inspector; grouped connections
and comparison alongside the source passage; word ranges before selection,
clickable places, and a visible event timeline with linked psalms/narratives;
existing advanced research and integrations behind clear study-oriented entries.
Separate lexical recurrence, statistical association, reviewed concepts, and
interpretive parallels. Preserve ambiguous lexemes, exact counting scope,
private occurrence translations, existing passage links and public contracts.

Full English text is a new audited source dependency: current glosses cannot
substitute for a continuous translation. Source/edition/reference mapping must
pass before full-verse previews can be accepted. Precise English highlighting
requires verified alignment; otherwise identify matched original words separately.
The diagram is a secondary view; Septuagint links retain their independent L1–L9
dependencies and approval status. Existing queues and pending O5/M1 checks remain.

Execute sequentially after approval; proposed file names can be refined during
design review. Each numbered task targets one or two files. Run the mandatory
pre-code/post-code pipeline for future source/database edits. Browser-check UI
tasks before requesting the applicable visual user check.

### UX design and text foundation

- [ ] **UX01 Review strategy and wireframes** | Files: UX_STRATEGY.md, UX_WIREFRAMES.md | Verify: [USER-CHECK] Approve desktop/phone hierarchy and no-selection, ambiguous-word, preview, comparison, and unavailable-data states; no application code changes.
- [ ] **UX02 Record approved architecture and capability audit** | Files: ARCHITECTURE.md, UX_STRATEGY.md | Verify: [AUTO-TEST] Live UI/data findings, existing-feature inventory, proposed RPC fields, legacy-link rules, counting scope, and independent-queue dependencies match the approved design; no inferred token senses or unverified coverage claims.
- [ ] **UX02a Audit lexical rendering ranges** | Files: DATA_SOURCES.md, scripts/audit-rendering-ranges.mjs | Verify: [AUTO-TEST] Cross-form ruach wind/spirit/breath/direction-side examples, source labels, homographs and observed-rendering versus semantic-group coverage are measured before publishing overview ranges.
- [ ] **UX02b Audit inline place anchors** | Files: scripts/audit-place-anchors.mjs, DATA_SOURCES.md | Verify: [AUTO-TEST] Existing place IDs, original token links, verified English spans and ambiguous/symbolic cases are inventoried; unresolved text spans never become guessed inline links.
- [ ] **UX02c Audit event and psalm associations** | Files: scripts/audit-timeline-links.mjs, UX_STRATEGY.md | Verify: [AUTO-TEST] Published event IDs, superscription reference systems, Psalm 3 / 2 Samuel 15 and available Kings events have traced sources and explicit setting/composition/mention distinctions; missing coverage is recorded.
- [ ] **UX03 Audit readable English edition** | Files: scripts/audit-english-text.mjs, DATA_SOURCES.md | Verify: [AUTO-TEST] Pin source/edition/files/hashes, reuse terms, book coverage, heading/verse mappings and textual differences; report unmapped reasons and independently measured counts before import.
- [ ] **UX04 Prepare reproducible English import** | Files: scripts/import-english-text.mjs, scripts/verify-english-text.mjs | Verify: [AUTO-TEST] Dry-run output matches audited source and mapping totals; original corpus IDs/hashes and private choices remain unchanged; missing/split verses are explicit.
- [ ] **UX05 Add English text storage** | Files: new additive English-text migration, scripts/verify-english-text.sql | Verify: [AUTO-TEST] Source/edition/reference identity, deterministic import, indexes, public SELECT access and denied unauthorized writes pass against audited counts.
- [ ] **UX06 Add bounded verse preview RPC** | Files: new additive verse-preview migration, scripts/verify-verse-previews.sql | Verify: [AUTO-TEST] Small batched requests return full attributed English text, mapping status and available matching-token evidence in stable order; payload limits, unavailable cases and query plans pass; existing RPCs retain behavior.
- [ ] **UX06a Add bounded word overview and occurrence continuation** | Files: new additive word-overview migration, scripts/verify-word-overview.sql | Verify: [AUTO-TEST] Versioned overview reuses existing definitions, grammar and candidate lexemes; stable occurrence cursors and exact token/verse totals retain base-Strong's scope and explicit unassigned senses without downloading the complete reference corpus; caller access and measured query plans pass.
- [ ] **UX06b Add bounded discovery search** | Files: new additive discovery-search migration, scripts/verify-discovery-search.sql | Verify: [AUTO-TEST] References, original forms, transliterations, English concepts and identifiers return labeled, stably paginated candidate types; ambiguous results remain distinct; normalization, coverage, access and measured query limits pass without changing legacy resolver behavior.
- [ ] **UX06c Add bounded rendering-range evidence** | Files: new additive rendering-range migration, scripts/verify-rendering-ranges.sql | Verify: [AUTO-TEST] Verse-batched lexical ranges aggregate audited forms in SQL, preserve homographs and source scope, return representative evidence and stable filtered occurrence continuation, and distinguish rendering totals from unassigned semantic senses.
- [ ] **UX06d Expose verified place anchors and focus targets** | Files: new additive place-anchor migration, scripts/verify-place-anchors.sql | Verify: [AUTO-TEST] Versioned read contract binds verified original-token/English-span occurrences to real place IDs; additive storage is used only for measured gaps; context role and unresolved alternatives survive caller access and performance checks.
- [ ] **UX06e Expose event timeline and cross-book links** | Files: new additive timeline migration, scripts/verify-timeline-links.sql | Verify: [AUTO-TEST] Bounded published-event neighbors and linked passages retain stable IDs, model/version, ranges, relationship/source evidence and undated states; reviewed association additions fill measured gaps without guessing composition dates.
- [ ] **UX07 Type and expose new reader contracts** | Files: src/api/types.ts, src/api/rpc.ts | Verify: [AUTO-TEST] Canonical preview/overview/search/range/place/timeline types and single-gateway reads preserve source identity, lexical ambiguity, entity/event IDs, count scope, cursors and explicit errors; required type/size/build checks pass.

### UX reading workspace and word understanding

- [ ] **UX08 Model intentional exploration state** | Files: src/ui/state.ts, scripts/verify-exploration-state.mjs | Verify: [AUTO-TEST] Repeated-token position, selected lexical candidate, source/target, connection filters, return state and legacy passage hashes behave consistently; hover creates no history entries or permanent selection changes.
- [ ] **UX09 Establish accessible visual foundations** | Files: src/ui/styles-base.css, src/ui/styles.css | Verify: [USER-CHECK] Approved type hierarchy, script/diacritic legibility, selection cues, light/dark contrast, focus visibility and reduced-motion behavior work on actual Hebrew/Greek passages.
- [ ] **UX10 Replace introductory layout with study workspace** | Files: src/main.ts, src/ui/styles-workspace.css | Verify: [USER-CHECK] Reader and inspector dominate the first desktop view; source passage remains visible during exploration; current navigation and private translations remain reachable.
- [ ] **UX11 Refresh passage and word lookup** | Files: src/ui/components/NavSelector.ts, src/ui/styles-navigation.css | Verify: [USER-CHECK] Reference lookup, previous/next, word/concept/identifier result labels, ambiguity and invalid-reference feedback are understandable and keyboard accessible using the audited UX06b/UX07 contract.
- [ ] **UX11a Build visible word rendering ranges** | Files: src/ui/components/WordRenderingRange.ts, src/ui/styles-reader.css | Verify: [USER-CHECK] Here/Elsewhere labels expose multiple supported English uses before selection; rendering hover previews real verses, group selection filters evidence without saving a choice, and mobile wrapping/homographs/missing groups remain understandable.
- [ ] **UX12 Add readable English and improve interlinear rhythm** | Files: src/ui/components/VerseReader.ts, src/ui/styles-reader.css | Verify: [USER-CHECK] Attributed full English text and occurrence glosses remain distinct; token selection, RTL/LTR, repeated words, unavailable edition text and private rendering affordances work without fabricated English alignment.
- [ ] **UX13 Build persistent word inspector** | Files: src/ui/components/WordInspector.ts, src/ui/styles-inspector.css | Verify: [USER-CHECK] Original form, transliteration, sourced meaning, readable grammar, ambiguity and evidence precede advanced metadata; no unsupported contextual sense or empty physical-definition section appears.
- [ ] **UX14 Wire inspector and preserve return paths** | Files: src/main.ts, src/ui/components/WordModal.ts | Verify: [USER-CHECK] Selected occurrence and documented suggested-word behavior update the inspector; related-word exploration and Back restore context; modal compatibility is deliberately migrated without stale results or lost focus.

### UX shared previews and visible connections

- [ ] **UX15 Bound preview requests and reuse public data** | Files: src/ui/preview-state.ts, scripts/verify-preview-state.mjs | Verify: [AUTO-TEST] Edition-aware bounded cache, small-batch prefetch, request deduplication and stale-response handling pass rapid target/navigation tests; public text and private rendering state remain separate.
- [ ] **UX16 Build shared preview surface** | Files: src/ui/components/ContextPreview.ts, src/ui/styles-preview.css | Verify: [USER-CHECK] Pointer dwell/focus preview is dismissible, hoverable and persistent; explicit detail actions use accessible focus behavior; viewport edges, long verses, pinning, loading/retry and touch sheets work without nested popups.
- [ ] **UX17 Connect reader and inspector previews** | Files: src/ui/components/VerseReader.ts, src/ui/components/WordInspector.ts | Verify: [USER-CHECK] Original words, grammar and available lexical references expose the shared preview; hover preserves selected occurrence and never changes a private translation.
- [ ] **UX18 Build occurrence discovery rows** | Files: src/ui/components/WordOccurrences.ts, src/ui/styles-connections.css | Verify: [USER-CHECK] Connection reason, representative excerpt, exact token/verse scope, returned/total count and reachable continuation appear together; full-verse preview, Compare and Open are available for pointer, touch and keyboard.
- [ ] **UX19 Mount occurrence rows and typed connection groups** | Files: src/ui/components/WordConnections.ts, src/ui/components/WordInspector.ts | Verify: [USER-CHECK] Occurrence discovery is reachable from the inspector; same-word, co-occurrence, related-concept and interpretive groups use real evidence and distinct labels; each explains why connected; unknown coverage and counterexamples are accessible; current cached top-seven scope is explicit.
- [ ] **UX20 Add compact optional connection diagram** | Files: src/ui/components/ConnectionDiagram.ts, src/ui/styles-connections.css | Verify: [USER-CHECK] Small stable graph and equivalent list expose the same typed evidence and preview actions; one-step expansion, edge explanations, keyboard access and reduced motion work without implying unsupported relationships.
- [ ] **UX21 Add passage comparison** | Files: src/ui/components/PassageComparison.ts, src/ui/styles-comparison.css | Verify: [USER-CHECK] Source and target retain full English text, edition labels and original-word evidence; narrow layouts stack clearly; explicit navigation and return restore the original word and reading position.

### UX contextual tools, mobile and acceptance

- [ ] **UX22a Link place names directly to geography** | Files: src/ui/components/PlaceNameLink.ts, src/ui/components/VerseReader.ts | Verify: [USER-CHECK] Verified place names open the focused map in one action, lexical inspection remains separate, fallback place rows explain inherited context, and uncertain/symbolic targets never acquire invented precise coordinates.
- [ ] **UX22b Build visible event timeline** | Files: src/ui/components/EventTimeline.ts, src/ui/styles-timeline.css | Verify: [USER-CHECK] Overview shows era, active event, linked text lane and source reason before any inspector click; Psalm 3 links to its audited 2 Samuel context; relative/uncertain dates and keyboard/mobile list alternatives remain clear.
- [ ] **UX22c Synchronize reader, event and map focus** | Files: src/main.ts, src/ui/components/VerseMap.ts | Verify: [USER-CHECK] Place/event selection preserves the source passage, focuses the correct target and model-era, previews/compares linked texts and restores focus/position on return without stale responses or direct cross-component DOM mutation.
- [ ] **UX22 Integrate existing research tools** | Files: src/main.ts, src/ui/components/ResearchPanel.ts | Verify: [USER-CHECK] Study-oriented navigation reaches all existing research, patterns, exports and OpenAPI/MCP information without requiring prompt numbers for ordinary reading; time/place remain first-class overview content.
- [ ] **UX23 Complete phone and tablet interaction** | Files: src/ui/styles-mobile.css, src/main.ts | Verify: [USER-CHECK] 320–430 px phones and tablet widths support full verse reading, selected-word summary, reachable sheet close, explicit previews, stacked comparison and comfortable touch targets with no page overflow or nested sheets.
- [ ] **UX24 Verify exploration journeys and accessibility** | Files: scripts/verify-ux-refresh.mjs, scripts/fixtures/ux-refresh-cases.json | Verify: [AUTO-TEST] Hebrew/Greek, repeated words, homographs, heading/edition gaps, exact scoped totals, pagination, keyboard/focus, touch, offline/partial data and stale requests pass meaningful browser assertions; collect cold/warm preview latency and request volume.
- [ ] **UX25 Migrate existing research navigation assertions** | Files: scripts/verify-research-ui.mjs, scripts/verify-hydrated-ui.mjs | Verify: [AUTO-TEST] Replace obsolete tab-count assumptions with capability/journey checks; retain all existing research, prompt/export and hydration coverage; run existing reader/translation regressions and required type/size/build gates.
- [ ] **UX26 Validate first-glance understanding** | Files: UX_STRATEGY.md, UX_VALIDATION.md | Verify: [USER-CHECK] Record observed novice/experienced-reader results against proposed meaning/connection, preview and comparison targets; revise labels/hierarchy where needed; distinguish measured results from hypotheses and retain unresolved acceptance items.
- [ ] **UX27 Synchronize approved delivery documentation** | Files: PROJECTMAP.md, TASKS.md | Verify: [AUTO-TEST] Component registry, reusable preview ownership, verification commands and actual completion evidence match delivery; independent queues retain their statuses and no unapproved rollout is implied.

First usable milestone includes UX01–UX19 and UX22a–UX23, with all added audit and
data-contract prerequisites: visible English word ranges, reader/inspector,
occurrence previews, clickable places and event/psalm connections are required.
The diagram, fuller comparison and advanced-tool reorganization follow. The optional diagram can be deferred if formative testing shows
the grouped list explains connections more clearly. UX24–UX26 acceptance applies
to each delivered milestone, not only to the final release. Performance goals
are hypotheses to measure, not claims that current contracts meet them.

## Proposed feature: direct Septuagint word connections

Design: [SEPTUAGINT_DESIGN.md](SEPTUAGINT_DESIGN.md). Requested 2026-11-02;
awaiting pre-code approval for the additive schema/API architecture. Preserve
the independent workflow, gematria and translation queues.

- [ ] **L1 Source payload and coverage audit** | Files: scripts/audit-lxx.mjs, DATA_SOURCES.md | Verify: [AUTO-TEST] Pin actual MACULA release/files/hashes; inspect equivalents, namespace rules, references, edition metadata and rights; publish measured coverage and unmapped reasons before schema work.
- [ ] **L2 Additive evidence storage and import** | Files: new additive migration, scripts/import-lxx.mjs | Verify: [AUTO-TEST] Source units and grouped correspondences retain provenance; imported counts match independent audit; both-direction indexes, RLS and grants pass; existing corpus hashes remain unchanged.
- [ ] **L3 Bidirectional database lookup** | Files: new additive migration, scripts/verify-lxx.sql | Verify: [AUTO-TEST] Versioned RPC returns exact distinct evidence totals, stable pagination, both directions, mapping status and coverage with measured query plans.
- [ ] **L4 Canonical contract and gateway** | Files: src/api/types.ts, src/api/rpc.ts | Verify: [AUTO-TEST] Typed lookup uses the existing gateway and real optional counterpart IDs; type/size/build and unavailable/error behavior pass.
- [ ] **L5 Septuagint evidence component** | Files: src/ui/components/LxxConnections.ts, src/ui/styles-lxx.css | Verify: [AUTO-TEST] Source equivalents, counts, evidence expansion, accessible controls and explicit missing/unmapped states render correctly.
- [ ] **L6 Inspector navigation and integration** | Files: src/ui/components/WordModal.ts, src/main.ts | Verify: [USER-CHECK] Hebrew-to-Greek and Greek-to-Hebrew counterpart navigation, RTL/LTR, keyboard/mobile and stale-response protection work in the reader.
- [ ] **L7 Public REST and MCP contracts** | Files: supabase/openapi.json, supabase/functions/bible-mcp/catalog.ts | Verify: [AUTO-TEST] Both public surfaces expose the same read-only paginated SQL evidence without breaking existing tools.
- [ ] **L8 Hydrated research integration** | Files: new additive migration, src/api/types.ts | Verify: [AUTO-TEST] Optional additive LXX evidence has standalone RPC parity and explicit coverage without expanding default packets unexpectedly.
- [ ] **L9 Regression and rollout documentation** | Files: scripts/verify-lxx.mjs, RESEARCH_API.md | Verify: [AUTO-TEST] Live SQL/REST/MCP parity, existing regression and static/build gates pass; measured coverage, limits, deployment and registry documentation are synchronized.

## Active feature: hydrated research optimization, contiguous ranges (up to 100 verses), payload deduplication, grammar decoding, and polysemy preservation

User approved on 2026-11-02 with verse limit expanded up to 100 verses max in analysis profile.

- [x] **O1 Server-Side Grammar Decoding & Lexeme Polysemy Migration** | Files: supabase/migrations/20261102010000_grammar_and_polysemy.sql, scripts/verify-grammar-decoding.sql | Verify: [AUTO-TEST] PostgreSQL function public.decode_grammar_v1(text) returns structured JSON for Hebrew (HVhrmsa, HNcmpa) and Greek (V-PAP-NSM, N-ASF); additive lexemes for H5869a/b are registered in public.lexemes.
- [x] **O2 Bounded Range Hydration & Top-Level Deduplication RPC** | Files: supabase/migrations/20261102020000_optimized_hydrated_research.sql, scripts/verify-hydrated-research.sql | Verify: [AUTO-TEST] get_verse_research_v1 expands contiguous spans up to 100 verses under profile: "analysis", hoists chronology, geography, and semantic_evidence to top-level dictionaries keyed by verse ref, and includes decoded grammar.
- [x] **O3 Canonical Research Types and Gateway Update** | Files: src/api/types.ts, src/api/rpc.ts | Verify: [AUTO-TEST] Updated VerseResearchRequest, HydratedResearchWord, and VerseResearchPacket typecheck cleanly under npm.cmd run check:types and npm.cmd run check:size.
- [x] **O4 MCP Hydration & Workflow Contract Alignment** | Files: supabase/functions/bible-mcp/catalog.ts, supabase/functions/bible-mcp/workflow-contract.ts, supabase/functions/bible-mcp/research-workflow.ts, skills/bible-research/SKILL.md | Verify: [AUTO-TEST] MCP tool get_verse_research accepts range inputs up to 100 verses and returns hoisted dictionaries; prompt instructions explicitly enforce polysemy and homograph exploration.
- [-] **O5 Hydrated Research UI Integration** | Files: src/ui/components/HydratedResearch.ts, src/ui/styles.css | Verify: [USER-CHECK] Verse range entry (e.g. Zechariah 4:1–14), JSON preview, and prompt export adapt to top-level dictionaries with zero console errors.
- [x] **O6 OpenAPI 3.1.0 and Acceptance Test Suite** | Files: supabase/openapi.json, scripts/verify-hydrated-research.mjs, scripts/fixtures/hydrated-research-cases.json, RESEARCH_API.md | Verify: [AUTO-TEST] Up to 100-verse pericope ingestion, payload size benchmarks (~60–70% reduction), grammar decoding assertions, and OpenAPI validation pass.

## Active feature: shared AI research skill and workflow

User approved implementation of the preceding workflow recommendation on
2026-11-02. This queue preserves the independent gematria and translation work.

- [x] **W1 Shared research skill** | Files: skills/bible-research/SKILL.md, skills/bible-research/references/tool-contracts.md | Verify: [AUTO-TEST] Focused activation, intent routing, proportional research, evidence/interpretation distinctions and graceful missing-tool behavior are defined without overriding user choices.
- [x] **W2 Portable client packages** | Files: integrations/*, scripts/build-research-plugin.mjs | Verify: [AUTO-TEST] One canonical skill produces matching OpenAI/Gemini packages and server workflow text; manifests contain only public MCP connection data and packages are reproducible.
- [x] **W3 MCP workflow and analysis profile** | Files: supabase/functions/bible-mcp/catalog.ts, supabase/functions/bible-mcp/pattern-prompts.ts | Verify: [AUTO-TEST] Default study_bible workflow is tool-accessible, all prior prompts remain, explicit analysis profile reduces reference volume while preserving exact totals, and explicit/full requests retain their behavior.
- [x] **W4 Workflow verification and evaluation cases** | Files: scripts/verify-research-workflow.mjs, scripts/fixtures/research-workflow-cases.json | Verify: [AUTO-TEST] Routing/profile contracts, client packages, missing/ambiguous data, prompt injection boundaries, and a reusable ChatGPT/Gemini behavioral rubric are checked without claiming unrun provider evaluations.
- [x] **W5 Deploy and document workflow** | Files: supabase/functions/bible-mcp/index.ts, MCP_SETUP.md | Verify: [AUTO-TEST] Live discovery, workflow retrieval, profile data parity/size, existing MCP checks, type/size/build and package validation pass; unchanged REST contracts and remaining client-side installation/refresh actions are documented.

Workflow verification on 2026-11-02: MCP deployment 7 serves v1.4.0 with 11 tools,
17 prompts and expected-tool metadata for detecting stale client catalogs.
The Skill Creator validator and official portable manifest schemas pass. The
canonical skill, generated server module, OpenAI/Gemini package copies and local
profile/default/override/chronology contracts pass. All 14 live MCP check groups
and hydration browser checks pass. John 1:1 analysis/full parity preserves verse
evidence, exact totals, ranked connections and lexeme candidates while reducing
structured JSON by 81% (242,204 vs 1,274,531 bytes). Type, size/TOC, build and
Edge Function typechecks pass. Personal Codex skill installation is complete;
Codex recognizes the bible-research-local personal marketplace, with the package
available for ChatGPT desktop installation after restart. The portable package
is prepared for Gemini CLI, which is not installed here. Existing web clients
still need schema refresh; no tool can replace this chat's cached tool list.
Twenty-two scenarios are evaluation rubrics, not completed ChatGPT/Gemini model
runs. Other feature queues and their acceptance status are preserved.

## Mobile UI improvements

- [-] **M1 Responsive reader and research interface** | Files: src/main.ts, src/ui/styles-mobile.css | Verify: [USER-CHECK] Phone navigation, readable forms, touch targets, word inspector, chronology, map controls, and all research tabs fit 320–430px screens; desktop layout preserved.

Agent verification (2026-11-02): type, size/TOC, build, diff whitespace, and all six
existing reader browser regression groups pass. Edge phone emulation checks at
320, 360, 390, 430, 680, and 768px pass for both Hebrew and Greek, all nine
research tabs, page width, form/touch sizes, passage submission, and reachable
inspector close after scrolling, with zero page errors. Recorded public John 1:1
geography/chronology responses verify context layouts and map/disclosure controls
at 320, 390, 430, and 768px. Live context verification timed out. The older
`verify-research-ui.mjs` stops at its obsolete five-tab assertion (the app has
nine); the targeted mobile check covers all nine. M1 awaits the post-code skill's
visual user sign-off; no checkpoint committed.

## Active Feature: Word Gematria (Hebrew & Greek Standard)

Design: [ARCHITECTURE.md](ARCHITECTURE.md). Standard Hebrew Gematria and Greek Isopsephy computed in PostgreSQL and displayed in WordModal.

- [x] **G1 Database Gematria calculation and schema migration** | Files: supabase/migrations/20261102000000_word_gematria.sql, scripts/verify-gematria-db.sql | Verify: [AUTO-TEST] Live caller-RLS database function `public.calculate_gematria(text)` and `public.words.gematria` column return exact values for Hebrew (Genesis 1:1) and Greek (John 1:1) words.
- [x] **G2 Canonical types, sample fixtures, and gateway** | Files: src/api/types.ts, src/api/rpc.ts | Verify: [AUTO-TEST] `WordRecord` interface includes `gematria: number | null`, `sampleWords` fixture is populated, and `BibleRPC.getWordDetails` provides gematria under type and size checks.
- [-] **G3 Word Inspector modal UI integration** | Files: src/ui/components/WordModal.ts, src/ui/styles-modal.css | Verify: [USER-CHECK] Word modal renders discrete Gematria badge in `.word-meta` with verified values upon word inspection.

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
