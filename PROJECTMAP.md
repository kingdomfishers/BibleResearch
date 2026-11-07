# PROJECTMAP.md — Progressive Context & DRY Registry

> **Agent Rule:** Read this file during `pre-code` (Step 2) to reuse existing modules or promote candidates, and update it during `post-code` (Step 2) whenever files, sections, or tests change.

---

## 1. Active Shared (`src/api/` & `src/ui/state.ts`)
Core modules used across 2+ components. Import these directly—never duplicate their logic.

| Filepath | Responsibility | Exported Symbols | Tables / RPCs Touched |
| :--- | :--- | :--- | :--- |
| `src/api/supabase.ts` | Single Supabase client with persistent private reader session and single-flight anonymous creation | `supabase`, `restoreReaderSession`, `ensureReaderSession` | `words`, `verses`, `word_translation_choices` |
| `src/api/types.ts` | Canonical TypeScript interfaces for corpus, translations, chronology, geography, relationships and hydrated research packets | `WordRecord`, `VerseWordToken`, `WordOccurrence`, `HydratedCoOccurrence`, `WordRelationship`, `ActivePassage`, `ChronologyResponse`, `VerseGeographyResponse`, `RelationshipResearchPacket`, `VerseResearchRequest`, `VerseResearchResponse`, `VerseResearchPacket`, `HydratedResearchWord`, `HydratedLexicalEntry` | All public tables |
| `src/api/rpc.ts` | Single Database Gateway wrapping 8 research RPCs, translations, word lookup and geography cache | `BibleRPC` (`getVerseWords`, `getWordOccurrences`, `getWordCoOccurrences`, `getWordRelationships`, `getWordDetails`, `getVerseChronology`, `getVerseGeography`, `getVerseResearch`, `researchRelationships`, `resolveWordId`) | All public RPCs |
| `src/api/lexical-types.ts` | Canonical lexical/evidence response types for the 7 deterministic lookup RPCs (re-exported by `types.ts`) | `WordToLemmaSensesResponse`, `LemmaOccurrencesResponse`, `LemmaRootRelativesResponse`, `LemmaEnglishGlossesResponse`, `PassageTokensSyntaxResponse`, `ConceptPropertiesResponse`, `EntityRelationshipsResponse` | `lemmas`, `word_form_lemmas`, `lexical_roots`, `lexical_senses`, `syntax_*`, `entity_relationships` |
| `src/api/septuagint-types.ts` | Canonical Septuagint & Hebrew-Greek comparison response types (re-exported by `types.ts`) | `HebrewToGreekAlignmentsResponse`, `GreekToHebrewAlignmentsResponse`, `HebrewSeptuagintParallelResponse`, `CrossTestamentGreekResponse` | `lxx_swete_words`, `lxx_swete_books`, `hebrew_lxx_verse_map`, `macula_hebrew_morphemes`, `macula_gated_field_values`, `field_license_registry` |
| `src/api/septuagint-evidence-types.ts` | Complete 55-book Septuagint passage evidence response types with raw Unicode vs normalized text, MT-LXX alignments, and annotation disclaimers (re-exported by `types.ts`) | `SeptuagintPassageResponse`, `SeptuagintToken`, `SeptuagintBookMetadata`, `SeptuagintVersificationMapping`, `SeptuagintPassageSummary` | `lxx_swete_words`, `lxx_swete_books`, `hebrew_lxx_verse_map`, `source_releases`, `source_editions` |
| `src/api/hebrew-evidence-types.ts` | Canonical Hebrew evidence, morphhb Ketiv/Qere, MACULA morphemes, and syntax tree response types (re-exported by `types.ts`) | `HebrewVerseEvidenceResponse`, `HebrewVerseToken`, `MorphhbTokenRecord`, `MaculaHebrewMorphemeRecord`, `HebrewSyntaxNodeRecord`, `HebrewSyntaxEdgeRecord`, `CrossTokenMappingRecord`, `HebrewVerseEvidenceSummary` | `morphhb_tokens`, `macula_hebrew_morphemes`, `syntax_nodes`, `syntax_edges`, `cross_token_mappings`, `verses`, `words` |
| `src/api/greek-evidence-types.ts` | Canonical Greek NT evidence, TAGNT edition sets/variants, and MACULA Greek response types (re-exported by `types.ts`) | `GreekVerseEvidenceResponse`, `TagntTokenRecord`, `MaculaGreekTokenRecord`, `GreekVerseEvidenceSummary` | `tagnt_tokens`, `macula_greek_tokens`, `words`, `verses` |
| `src/api/lexical-semantics-types.ts` | Canonical lexical semantics response types for multi-tier Unicode lookups, separating surface forms, lemmas, lexemes, roots, senses, and translation glosses with strict invariants (re-exported by `types.ts`) | `LexicalSemanticsResponse`, `LexicalSemanticsLemma`, `LexicalSemanticsSense`, `LexicalSemanticsGloss`, `LexicalSemanticsRoot`, `LexicalSemanticsLexeme` | `lemmas`, `lexemes`, `lexical_roots`, `lexical_senses`, `verse_translation_sources`, `words` |
| `src/api/syntax-types.ts` | Hierarchical syntax tree & grammatical relationship response types, separating word morphology, phrase/clause hierarchy, syntactic roles, semantic frames, and cross-verse spans (re-exported by `types.ts`) | `SyntaxTreeResponse`, `SyntaxTreeRecord`, `SyntaxNodeRecord`, `SyntaxEdgeRecord`, `CrossVerseSpanSummary`, `SyntaxValidationResponse` | `syntax_nodes`, `syntax_edges`, `words`, `verses` |
| `src/api/hebrew-septuagint-comparison-types.ts` | Canonical Hebrew-Septuagint comparison response types, 3-tier alignments, token-level status, TVTMS shifts, and epistemic disclaimers (re-exported by `types.ts`) | `HebrewLxxAlignment`, `HebrewComparisonWord`, `SeptuagintComparisonWord`, `HebrewComparisonPassage`, `SeptuagintComparisonPassage`, `HebrewSeptuagintVerseMapping`, `HebrewSeptuagintCompareArgs`, `HebrewSeptuagintComparisonResponse`, `HebrewSeptuagintAlignmentsResponse` | `hebrew_lxx_word_alignments`, `hebrew_lxx_verse_map`, `lxx_swete_words`, `words`, `verses` |
| `src/api/formation-types.ts` | Canonical lexical formation, morpheme components, roots, and hydrated v2 response types (re-exported by `types.ts`) | `WordFormationResponse`, `OrthographicCandidatesResponse`, `VerseResearchV2Packet`, `LexicalFormationRecord`, `LemmaComponentRecord`, `FormationCoverage` | `lexical_formations`, `lemma_components`, `lexical_roots`, `lexical_connections`, `orthographic_candidates` |
| `src/api/notes-types.ts` | Canonical notes & connections layer data models: NoteAuthor, NoteKind, NoteAnchor (discriminated union by kind), NoteConnection, NoteBlock (discriminated by block_type), Note, and NoteDetailResponse (re-exported by `types.ts`) | `NoteAuthor`, `NoteKind`, `AnchorKind`, `NoteAnchor`, `VerseAnchor`, `WordOccurrenceAnchor`, `NoteConnection`, `NoteBlock`, `Note`, `NoteDetailResponse` | `notes`, `note_anchors`, `note_connections`, `note_blocks`, `note_authors` |
| `src/api/notes-api-types.ts` | Notes RPC requests, responses, pagination cursors, candidate groups, payloads, and write results (re-exported by `notes-types.ts`) | `PassageNotesResponse`, `WordNotesResponse`, `NoteListResponse`, `ConnectionTypesResponse`, `TargetSearchResponse`, `NoteSavePayload`, `NoteWriteResult`, `NoteErrorCode` | `notes`, `note_anchors`, `note_connections`, `note_blocks`, `note_authors` |
| `src/api/rpc.ts` (canonical lookups) | `BibleRPC.lookupWordToLemmaSenses`, `lookupLemmaOccurrences`, `lookupLemmaRootRelatives`, `lookupLemmaEnglishGlosses`, `lookupPassageTokensSyntax`, `lookupConceptProperties`, `lookupEntityRelationships`, `lookupHebrewToGreekAlignments`, `lookupGreekToHebrewAlignments`, `getHebrewSeptuagintParallel`, `lookupCrossTestamentGreek`, `lookupHebrewVerseEvidence`, `lookupGreekVerseEvidence`, `lookupLexicalSemantics`, `lookupSyntaxTree`, `lookupSeptuagintPassage`, `lookupSeptuagintByCanonicalVerse`, `compareHebrewSeptuagintPassage`, `lookupHebrewSeptuagintAlignments`, `lookupWordFormation`, `suggestOrthographicCandidates`, `getVerseResearchV2` | see `@section:logic:canonical-lookups` & `@section:logic:corpus-lookups` | `lookup_*_v1`, `get_hebrew_septuagint_parallel_v1`, `compare_hebrew_septuagint_passage_v1`, `lookup_hebrew_septuagint_alignments_v1`, `get_word_formation_v1`, `suggest_orthographic_candidates_v1`, `get_verse_research_v2` RPCs |
| `src/ui/utils.ts` | Shared Bible book names, chapter counts, and reference formatter | `BIBLE_BOOKS`, `BOOK_CHAPTERS`, `formatVerseRef` | `none` |
| `src/ui/state.ts` | URL-hash (`#book-chapter-verse`) reactive store for current passage selection | `appState` (`getPassage`, `setPassage`, `subscribe`) | `none` |

---

## 2. Database & AI Plugin Layer (`supabase/`)
100% of data joins, unnesting, context inheritance, and proximity scoring live natively inside PostgreSQL.

| Filepath | Responsibility | Key Objects / Endpoints |
| :--- | :--- | :--- |
| `supabase/migrations/001_schema.sql` | Core tables, GIN index on `verses.word_ids`, and public read-only RLS policies | `public.words`, `public.verses`, `idx_verses_word_ids_gin` |
| `supabase/migrations/002_rpc_prompts.sql` | Native SQL functions for Prompts 1–4 & `resolve_word_id` | `resolve_word_id`, `prompt_verse_words`, `prompt_word_occurrences`, `prompt_word_cooccurrences`, `prompt_word_relationships` |
| `supabase/migrations/20261101013923_chronology_foundation.sql` | Additive chronology sources, models, events, assertions, and evidence schema | `chronology_sources`, `chronology_models`, `chronology_events`, `chronology_assertions`, `chronology_evidence` |
| `supabase/migrations/20261101014127_chronology_publication.sql` | Immutable chronology runs, passage assignments, and revision history | `chronology_runs`, `chronology_passage_assignments`, `chronology_revisions` |
| `supabase/migrations/20261101014636_chronology_rpc.sql` | Bounded chronology RPC with model comparison & evidence pagination | `get_verse_chronology_v1` |
| `supabase/migrations/20261107005245_chronology_creation_year_label.sql` | Dual date display: BC/AD date and years after creation (Adam 0, Jesus death and resurrection 4000) | `chronology_year_label` |
| `supabase/migrations/20261101023751_geography_schema.sql` | Normalized biblical geography tables, indexes, and `SELECT`-only RLS | `geography_sources`, `places`, `place_locations`, `passage_geography`, `verse_geography` |
| `supabase/migrations/20261101023954_geography_rpc.sql` | Deterministic 5-tier context-aware geography RPC + camelCase alias | `get_verse_geography`, `"getVerseGeography"` |
| `supabase/migrations/20261101183000_geography_composition_and_era.sql` | Epistolary/prophetic provenance (`composition_location`, `audience_location`), chronological era context, and period-synchronized ancient place names (`era_gazetteer`) | `get_verse_geography`, `passage_geography`, `places` |
| `supabase/migrations/20261101032932_relationship_research_schema_and_rpc.sql` | Additive lexeme/concept/evidence-graph schema, benchmark annotations, and one-lookup RPC | `source_releases`, `lexemes`, `concepts`, `concept_aliases`, `research_nodes`, `assertions`, `assertion_evidence`, `research_relationships_v1` |
| `supabase/openapi.json` | OpenAPI 3.1.0 spec pointing to `/rest/v1/rpc/*` for ChatGPT Actions & Gemini | All 8 research RPCs, `resolve_word_id`, and versioned translation read/save/reset |
| `supabase/migrations/20261101210538_hydrated_verse_research.sql` | Additive one-call public JSON hydration under caller RLS, excluding private choices | `get_verse_research_v1` |
| `supabase/migrations/20261101211815_hydrated_occurrence_batch.sql` | Set-based occurrence hydration with a single corpus token pass for all target Strong's groups | `get_verse_research_v1` replacement |
| `supabase/migrations/20261101212136_research_function_timeouts.sql` | Bounded per-function HTTP timeouts without changing role/global limits | Hydration 10s; initial relationship evidence budget |
| `supabase/migrations/20261101212411_relationship_timeout_budget.sql` | Match the relationship function to the existing eight-second reader budget; verify public REST regression | Relationship evidence 8s |
| `supabase/migrations/20261102000000_word_gematria.sql` | Immutable standard Hebrew Gematria and Greek Isopsephy function (`calculate_gematria`) and stored generated column | `public.calculate_gematria`, `public.words.gematria`, `idx_words_gematria` |
| `supabase/migrations/20261102010000_grammar_and_polysemy.sql` | PostgreSQL server-side grammar decoding function and polysemous candidate lexemes (`H5869a`/`b`) | `decode_grammar_v1`, `lexemes` |
| `supabase/migrations/20261102020000_optimized_hydrated_research.sql` | Contiguous verse range spans up to 100 verses, top-level hoisted deduplication dictionaries, server-side grammar decoding, and 15s function-scoped timeout | `get_verse_research_v1` |
| `supabase/functions/bible-mcp/catalog.ts` | 19 read-only tools and 18 prompts; default study_bible workflow, catalog metadata, lexical formation tools, and analysis/full hydration profiles | `createResearchServer`, `researchPrompt`, `PROMPTS`, `registerFormationTools` |
| `supabase/functions/bible-mcp/pattern-prompts.ts` | Shared pure catalog used by MCP and browser prompt-plus-data copy | `PATTERN_PROMPTS`, `PatternName`, `patternPrompt` |
| `supabase/functions/bible-mcp/index.ts` | Stateless Streamable HTTP endpoint (`v1.4.0`) with health metadata derived from the shared catalog | `createApp`, `createDatabaseReader` |
| `supabase/functions/bible-mcp/research-workflow.ts` | Generated Edge-safe copy of the canonical skill and contract reference | `WORKFLOW_VERSION`, `WORKFLOW_INSTRUCTIONS` |
| `supabase/functions/bible-mcp/workflow-contract.ts` | Delivery defaults, research intent routes and expected tool inventory (including `inspect_word_formation` & `suggest_word_connections`) | `RESEARCH_PROFILES`, `WORKFLOW_ROUTES`, `RESEARCH_TOOL_NAMES` |
| `supabase/migrations/20261106060000_septuagint_macula_schema.sql` | Septuagint & MACULA Hebrew schema: field_license_registry, lxx_swete_books, hebrew_lxx_verse_map, lxx_swete_words, macula_hebrew_morphemes, macula_gated_field_values | All 6 additive tables |
| `supabase/migrations/20261106063000_septuagint_comparison_rpcs.sql` | Deterministic comparison RPCs: forward/reverse alignments, parallel MT/LXX text with Psalm shift, and cross-testament Greek tracing | `lookup_hebrew_to_greek_alignments_v1`, `lookup_greek_to_hebrew_alignments_v1`, `get_hebrew_septuagint_parallel_v1`, `lookup_cross_testament_greek_v1` |
| `supabase/migrations/20261106093000_audit_evidence_coverage_rpc.sql` | Deterministic evidence coverage audit RPC returning exact table counts, duplicate metrics, foreign key orphan checks, and pilot incompleteness metrics | `audit_evidence_coverage_v1` |
| `supabase/migrations/20261106100000_referential_integrity_and_quarantine.sql` | Strengthen referential integrity, enforce check constraints on roots/senses/lemmas/morphemes/relationships, direct provenance on LXX words, and deploy `quarantined_evidence_records` table | `quarantined_evidence_records`, `lxx_swete_words` |
| `supabase/migrations/20261106103000_fix_gloss_reference_coupling_rpc.sql` | Coherent row-level pairing of `(verse_id, source_ref, book, chapter, verse)` in `lookup_lemma_english_glosses_v1` via `first_occ` | `lookup_lemma_english_glosses_v1` replacement |
| `supabase/migrations/20261106110000_verify_referential_integrity_rpc.sql` | Deterministic referential integrity verification function asserting FK and domain constraint rejection, direct provenance, and orphan counts | `verify_referential_integrity_v1` |
| `supabase/migrations/20261106120000_hebrew_morphhb_and_syntax_schema.sql` | Additive schema for morphhb tokens, cross-token mappings, Ketiv/Qere and Aramaic tagging, and batch ingestion RPCs | `morphhb_tokens`, `cross_token_mappings`, `ingest_morphhb_batch_v1`, `ingest_macula_batch_v1` |
| `supabase/migrations/20261106123000_hebrew_passage_syntax_and_ketiv_rpc.sql` | Deterministic lookup RPC for Hebrew verse evidence, Ketiv/Qere variants, morphemes, syntax trees, and cross-source token mappings | `lookup_hebrew_verse_evidence_v1` |
| `supabase/migrations/20261106130000_greek_tagnt_and_macula_schema.sql` | Additive schema for Greek NT TAGNT tokens, MACULA Greek (Nestle 1904 & SBLGNT) tokens, field license registry, and batch ingestion RPCs | `public.tagnt_tokens`, `public.macula_greek_tokens`, `ingest_tagnt_batch_v1`, `ingest_macula_greek_batch_v1` |
| `supabase/migrations/20261106133000_greek_passage_evidence_rpc.sql` | Deterministic lookup RPC for Greek NT verse evidence combining STEP words, TAGNT edition sets/variants, MACULA readings, and edition difference detection | `lookup_greek_verse_evidence_v1` |
| `supabase/migrations/20261106140000_lexical_semantics_unicode_and_matching_rpc.sql` | Multi-tier Unicode normalization (Hebrew vowels/cantillation, Greek accents/breathing), homograph disambiguation, root/sense/gloss separation, and `lookup_lexical_semantics_v1` RPC | `lookup_lexical_semantics_v1`, `strip_hebrew_cantillation`, `strip_hebrew_all`, `harmonize_greek_accents`, `strip_greek_diacritics` |
| `supabase/migrations/20261106150000_macula_syntax_trees_and_relationships_schema.sql` | Additive schema for full hierarchical syntax trees, parent-child links, cross-verse spans, terminal word associations, and batch ingestion | `public.syntax_nodes`, `public.syntax_edges`, `ingest_syntax_tree_batch_v1` |
| `supabase/migrations/20261106153000_syntax_lookup_and_validation_rpc.sql` | Deterministic lookup RPC for constituent syntax trees, grammatical roles, semantic frames, cross-verse spans, and structural integrity validator | `lookup_syntax_tree_v1`, `validate_syntax_tree_integrity_v1` |
| `supabase/migrations/20261106160000_swete_septuagint_full_coverage_schema.sql` | Additive schema for full 55-book Septuagint coverage, `chapter_suffix`, stored `normalized_word` for search, and batch ingestion RPCs | `public.lxx_swete_words`, `public.hebrew_lxx_verse_map`, `ingest_swete_words_batch_v1`, `ingest_hebrew_lxx_mappings_batch_v1` |
| `supabase/migrations/20261106163000_septuagint_evidence_rpc.sql` | Deterministic lookup RPC for Septuagint passages, returning raw Greek tokens, normalized search forms, MT-LXX parallel alignments, deuterocanonical status, and explicit epistemic disclaimers | `lookup_septuagint_passage_v1`, `lookup_septuagint_by_canonical_verse_v1` |
| `supabase/migrations/20261106170000_hebrew_septuagint_rigorous_comparison_schema.sql` | Additive schema for 3-tier word alignments (`public.hebrew_lxx_word_alignments`), TVTMS versification reorderings and omissions in `public.hebrew_lxx_verse_map`, and database-native candidate masquerade prevention constraint | `public.hebrew_lxx_word_alignments`, `public.hebrew_lxx_verse_map`, `ingest_hebrew_lxx_word_alignments_batch_v1` |
| `supabase/migrations/20261106173000_hebrew_septuagint_comparison_rpc.sql` | Deterministic bidirectional passage comparison RPC and 3-tier alignment search with strict epistemic segregation and token-level status | `compare_hebrew_septuagint_passage_v1`, `lookup_hebrew_septuagint_alignments_v1` |
| `supabase/migrations/20261107004527_lexical_formation_evidence_foundation.sql` | Additive lexical formation, components, and connections schema with RLS and quarantine integration | `public.lexical_formations`, `public.lemma_components`, `public.lexical_connections` |
| `supabase/migrations/20261107004622_word_formation_research_rpc_v1.sql` | Sourced compound elements, documented roots, and connection packet lookup RPC | `public.get_word_formation_v1` |
| `supabase/migrations/20261107004742_word_formation_orthographic_candidates_rpc_v1.sql` | Exploratory orthographic candidate suggestion RPC preserving epistemic candidate boundary | `public.suggest_orthographic_candidates_v1` |
| `supabase/migrations/20261107004845_hebrew_final_letter_orthographic_normalization.sql` | Final letter normalization (ךםןףץ -> כמנפצ) in candidate generation | `public.suggest_orthographic_candidates_v1` |
| `supabase/migrations/20261107011235_lexical_formation_batch_and_candidates.sql` | Batch ETL ingestion RPCs, multi-query candidate discovery, and Greek final sigma normalization | `ingest_lexical_formations_batch_v1`, `ingest_quarantined_records_batch_v1`, `batch_suggest_orthographic_candidates_v1` |
| `supabase/migrations/20261107011923_word_formation_query_normalization_and_fixes.sql` | Normalized query lookup in `get_word_formation_v1`, `word_formation_research_rpc_v1` alias, and resilient lemma resolution | `public.get_word_formation_v1`, `public.word_formation_research_rpc_v1`, `public.ingest_lexical_formations_batch_v1` |

---

### Private occurrence translations

`supabase/migrations/20261101162259_word_translation_schema.sql` adds
`verse_translation_sources` and owner-scoped `word_translation_choices`.
`scripts/verify-translations-schema.sql` verifies RLS and privileges.
`supabase/migrations/20261101162405_word_translation_rpc.sql` adds caller-RLS
read/save/reset RPCs and a trigger validating direct writes against source options.
`scripts/verify-translations-rpc.sql` verifies read compatibility and grants.
`scripts/import-translations.mjs` prepares the pinned, whole-corpus-hash-verified
occurrence import: 443,524 renderings across 31,203 verses, preserving corpus IDs.
`VerseTranslationToken` and `TranslationSaveResult` describe the versioned data;
`BibleRPC.getVerseTranslations`, `getSampleTranslations`, and `saveTranslation`
restore caller-owned choices and save/reset through a persistent reader session.
`scripts/verify-translations.mjs` checks public ordering/grammar and produces
rollback-only SQL for ownership, validation, and reset verification.
`supabase/openapi.json` documents the versioned translation read and authenticated
save/reset endpoints; public MCP research endpoints remain read-only.
Live browser acceptance passed after anonymous Auth was enabled: private reload,
reset, repeated-occurrence isolation, two-reader privacy, error recovery, and
navigation during a pending save. Translation reads use an eight-second timeout;
the other existing gateway request deadlines are preserved.

## 3. Module & Component Index (`src/ui/` & `src/main.ts`)
Focused DOM components and application shell (max 450 lines/file, max 80 lines/`@section`).

| Filepath | `@feature` | Responsibility | Exported Symbols |
| :--- | :--- | :--- | :--- |
| `src/ui/components/NavSelector.ts` | `nav-selector` | Top navigation bar with Book, Chapter, Verse selectors and chronology summary badge | `createNavSelector` |
| `src/ui/components/VerseReader.ts` | `verse-reader` | Interlinear token reader with automatic RTL (Hebrew) / LTR (Greek) switching | `createVerseReader` |
| `src/ui/components/TranslationChoice.ts` | `verse-reader` | Native English dropdown with private save/reset and failure feedback | `createTranslationChoice`, `translationLabel` |
| `src/ui/components/WordModal.ts` | `word-modal` | Native `<dialog>` popup displaying Strong's nr, grammar, gematria badge, definitions, occurrences, and relationships | `createWordModal` |
| `src/ui/components/WordInspector.ts` | `word-modal` | Side drawer inspector rendering word details, unified homographs with meanings in different verses, and cached connections | `createWordInspector` |
| `src/ui/components/WordFormation.ts` | `word-modal` | Renders prominent Word Formation & Etymology cards, clickable decomposition components, and four distinct relationship tiers | `renderWordFormation`, `renderCategorizedConnections` |
| `src/ui/components/VerseMap.ts` | `verse-reader` | Collapsible `<details open>` context-aware geography map panel with chronological era banner, composition/audience provenance cards, disputed site switcher, and symbolic/unknown guard | `createVerseMap` |
| `src/ui/components/VerseMapCanvas.ts` | `verse-reader` | Lazy-loaded MapLibre GL JS canvas (`setWorkerUrl('/geo/maplibre-gl-worker.mjs')`) with `Historical + Modern`, `Ancient Atlas` (DARE/Pelagios + Natural Earth CC0), and `Modern OpenStreetMap` modes plus era-synchronized ancient DOM markers | `createVerseMapCanvas`, `BasemapMode` |
| `src/ui/components/ChronologyPanel.ts` | `verse-reader` | Multi-model chronology panel with assertions, archaeological/textual evidence, and model switcher | `createChronologyPanel` |
| `src/ui/components/ResearchPanel.ts` | `app-shell` | Eight research tabs, including hydration and pattern prompts, plus OpenAPI/MCP guide | `createResearchPanel` |
| `src/ui/components/HydratedResearch.ts` | `app-shell` | One-call multi-verse hydration, ten shared pattern templates, full JSON/prompt copy and download, explicit samples and stale-response protection | `createHydratedResearch`, `HydratedResearchHandle` |
| `src/ui/components/RelationshipExplorer.ts` | `app-shell` | Renders unified homographs with meanings in different verses, narrative parallels, intertextual chains, and counterexample controls | `renderRelationshipExplorerView` |
| `src/main.ts` | `app-shell` | Mounts all reader, map, chronology, modal, and research components and coordinates `appState` transitions | *(Entrypoint)* |
| `src/ui/styles-mobile.css` | `app-shell` | Responsive phone/tablet layout, 44px touch targets, 16px form controls, contained research text, and reachable inspector close button; imported after component styles | *(Stylesheet)* |

---

## 4. Reusable Candidates (1st Use — Co-located in `@section`)

| Candidate Name | Current Location (`@section`) | Description | Promote Target (on 2nd Use) |
| :--- | :--- | :--- | :--- |
| `chronology-elements` | `src/ui/components/ChronologyPanel.ts` (`@section:ui:chronology-elements`) | Safe DOM node and external citation link builders | `src/ui/utils.ts` |
| `map-style-builder` | `src/ui/components/VerseMapCanvas.ts` (`@section:logic:style`) | Self-hosted Natural Earth GeoJSON style specification builder | `src/ui/map-utils.ts` |
| `translation-label` | `src/ui/components/TranslationChoice.ts` (`@section:logic:translation-label`) | Source segmentation formatting and untranslated grammatical-particle labels | `src/ui/utils.ts` |

---

## 5. Reusable Test Scripts & Verification Queries

| Target / Scope | Verification Command | What It Verifies |
| :--- | :--- | :--- |
| **Static Type & Size Gate** | `npm.cmd run check:types; npm.cmd run check:size` | Zero TypeScript errors, max 450 lines/file, max 80 lines/`@section`, exact `@toc` header sync |
| **Canonical Books Suite** | `node scripts/verify-canonical-books.mjs` | All 66 canonical books metadata, testaments, original languages, USFM/Theographic codes, chapters, divisions, and RLS policies |
| **Corpus-Wide Lexeme Ingestion** | `node scripts/import-lexemes.mjs` | Ingests all 22,717 STEP TBESH/TBESG Hebrew & Greek lexemes into `public.lexemes` with 100% Strong's coverage and homograph preservation |
| **Baseline Corpus Integrity** | `node scripts/verify-bible-import.mjs` | Whole-corpus hashes, Prompts 1–4, and word details |
| **Chronology Rollout Suite** | `node scripts/verify-chronology-rollout.mjs` | All 31,203 passage assignments across 5 models, `get_verse_chronology_v1` RPC, and denied writes |
| **Geography RPC & Milestones 1–9** | `node scripts/verify-geography-rpc.mjs` | `Acts 17:22`, `John 4:7`, `John 4:20`, `Genesis 29:10`, `Exodus 15:23`/`19:2`, `Revelation 21:2` symbolic guard, `Acts 18:1` travel, and `getVerseGeography` alias |
| **Geography UI Contract Suite** | `node scripts/verify-geography-ui.mjs` | `VerseMap.ts`, `VerseMapCanvas.ts`, `styles-map.css`, and Milestone Tests 1–9 |
| **Relationship Evidence RPC** | `node scripts/verify-research-rpc.mjs` | `well` -> `marriage` (Gen 24, 29, Exod 2 + Gen 21/26 controls), `menorah` -> `seven spirits of God` (Exod 25, Zech 4, Rev 4:5/5:6 + Rev 1:20 control), and `H1254` homographs |
| **OpenAPI 3.1.0 & PostgREST** | `node scripts/verify-openapi.mjs` | Validates `supabase/openapi.json` and tests 9 public research/lookup endpoints |
| **Canonical Lexical & Evidence DB** | `node scripts/verify-canonical-lexical-db.mjs` | STEP SHA-256 pins, 18-table counts, form≠lemma≠root≠sense≠gloss invariants, homograph preservation, keyset pagination, provenance completeness, TBESH Meaning exclusion, anonymous write denial |
| **Public MCP Edge Function** | `node scripts/verify-bible-mcp.mjs` | End-to-end verification of all 17 read-only tools and 17 MCP prompts on `bible-mcp` |
| **Translation RPC and ownership** | `node scripts/verify-translations.mjs`, then execute generated `.artifacts/stepbible/verify-translation-ownership.sql` via MCP | Source-inflected English, sequence parity, denied anonymous writes, rollback-only private save/reset and two-reader RLS tests |
| **Translation browser acceptance** | `node scripts/verify-translations-ui.mjs` with `PLAYWRIGHT_MODULE` and optional `BROWSER_EXECUTABLE` | Source rows, options, RTL/LTR, mobile, offline labels, real private reload/reset and repeated-word isolation; reports pending when anonymous sign-in is disabled |
| **Hydrated research RPC** | `node scripts/verify-hydrated-research.mjs`; optional `--stress-only`; `scripts/verify-grammar-decoding.sql` and `scripts/verify-hydrated-research.sql` via MCP | Source parity, server grammar decoding, contiguous spans (up to 100 verses in analysis profile), top-level hoisted dictionaries (60-70% payload compression), polysemy preservation (H5869, H1254), caller privileges, packet size and public HTTP stress |
| **Hydrated research browser** | `node scripts/verify-hydrated-ui.mjs` with `PLAYWRIGHT_MODULE` and optional `BROWSER_EXECUTABLE` | One-call batches, ten templates, full JSON/prompt copy/download, explicit samples, offline errors, stale responses, keyboard and mobile |
| **Hydrated OpenAPI schema** | `node scripts/update-hydrated-openapi.mjs`; `node scripts/verify-hydrated-schema.mjs`; `node scripts/verify-openapi.mjs --hydration-only` | Reproducible OpenAPI generation, JSON Schema 2020-12 validation against the full browser-exported live packet, strict input boundaries and public RPC |
| **MCP local transport regression** | Deno run with `.artifacts/mcp-tools/deno.json` on `scripts/verify-bible-mcp-local.mjs` | Eleven read-only tools, seventeen prompts, general workflow/defaults, profile overrides, decimal chronology run IDs, direct hydration, input rejection, credential isolation, pagination and bounded retries |
| **Shared skill/package contract** | `node scripts/build-research-plugin.mjs`; `node scripts/verify-research-workflow.mjs` | Canonical skill and generated workflow parity, matching OpenAI/Gemini packages, public-only manifests, profile defaults and 22 behavioral evaluation rubrics |
| **Portable manifest schemas** | `node scripts/verify-research-package-schema.mjs` with optional AJV_MODULE | Validate plugin.json/mcp.json against the published Agent Plugins schemas |
| **Septuagint & Hebrew-Greek Comparison** | `node scripts/verify-septuagint-layer.mjs` | Gen 1:1 MT<->LXX parallel, Psalm 3:0 title shift -> LXX 3:1, Isaiah 53:7 <-> Acts 8:32 Greek correspondence, bidirectional lookups, and cross-testament tracing |
| **Evidence Coverage & Integrity Audit (F1)** | `node scripts/audit-evidence-coverage.mjs` | Pinned source digests, expected vs imported metrics, orphan/duplicate queries, annotation availability, MCP tool accessibility, 70-verse pilot detection, and `COVERAGE_REPORT.md` generation |
| **Referential Integrity & Provenance (F2)** | `node scripts/verify-referential-integrity.mjs` | Verifies before/after gloss-reference coupling fix (0 mismatches), database-native FK and domain check rejection, quarantine table queryability, direct LXX word provenance, variant preservation, zero orphans, and anonymous write denial across 6 tables |
| **Hebrew Corpus Integration (F3)** | `node scripts/verify-hebrew-corpus.mjs` | Verifies SHA-256 source checksums, complete 39-book declared coverage (306,786 morphhb tokens + 475,911 MACULA morphemes), Genesis 1:1–3 word ordering, Psalm 23 complete coverage, Ketiv/Qere representation (Gen 8:17, Ps 100:3, Prov 19:7), Biblical Aramaic tagging (Dan 2:4), zero duplicates, and 100% source traceability |
| **Greek Corpus Integration (F4)** | `node scripts/verify-greek-corpus.mjs` | Verifies SHA-256 source checksums, complete 27-book declared coverage (142,096 TAGNT tokens + 137,779 Nestle 1904 + 137,741 SBLGNT tokens = 417,616 total), John 1:1–5, Romans 3:21–26, John 1:18 variant, 1 John 5:7-8 Comma Johanneum, Matthew 6:13 doxology, Matt 1:1 orthography, zero duplicates, non-Septuagint isolation, and 100% source traceability |
| **Reliable Lexical Semantics (F5)** | `node scripts/verify-lexical-semantics.mjs` | Verifies multi-tier Unicode matching (Hebrew vowels/cantillation, Greek monotonic/polytonic accents), homograph disambiguation (H1254, H3722, H1696), strict separation of surface/lemma/lexeme/root/sense/gloss, 100% source attribution, non-synonymous root invariants, and exact concordance reproducibility |
| **Syntactic Structure & Grammatical Relationships (F6)** | `node scripts/verify-syntax-trees.mjs` | Verifies acyclicity (0 cycles), valid parent-child hierarchy, terminal token associations (0 orphans), word morphology vs constituent hierarchy distinction, exact Hebrew clause matches (Gen 1:1, Gen 1:2, Ps 23, Isa 53), exact Greek clause matches (John 1:1, Rom 3:21), cross-verse structures (Eph 1:3–6), missing syntax reporting, and query reproducibility |
| **Septuagint Corpus Integration (F7)** | `node scripts/verify-septuagint-corpus.mjs` | Verifies SHA-256 source checksums, complete 55-book declared coverage (588,579 tokens, 29,308 verse units, 22,633 MT-LXX mappings), raw Unicode text vs normalized search separation, Genesis 1–3 token ordering, Psalm 1/3/23/151 and Jeremiah 1/10 comparisons, deuterocanonical book verification, 0 duplicates, and explicit unannotated status |
| **Rigorous Hebrew–Septuagint Comparison (F8)** | `node scripts/verify-hebrew-septuagint-comparison.mjs` | Verifies Psalm versification shifts (Ps 3:0->3:1), Jeremiah major reorderings/omissions (Jer 25:15->32:1, Jer 46->26, Jer 50->27, Jer 10:6-8/10 missing, Jer 33:14-26 missing), Gen 1:2 both passages without fake word equivalences, explicit unmatched status, bidirectional 1:many alignments, candidate segregation (`chk_candidate_never_masquerade`), alignment lookup, and reproducibility |
| **Evidence Access & MCP Parity (F9)** | `node scripts/verify-evidence-access.mjs` | Verifies end-to-end evidence access and complete parity between 17 read-only MCP tools on `bible-mcp` and direct PostgreSQL PostgREST RPCs across Hebrew, Greek NT, Septuagint, lexical semantics, constituent syntax trees, Hebrew-Septuagint comparisons, evidence coverage audits, anti-hallucination reporting, and RLS anonymous write denial |
| **Notes Guard & Regression Baseline (NOTE-02a)** | `node scripts/notes-guard.mjs [--snapshot \| --compare \| --static]` | Captures/compares exact row counts, Gen 1:1 research hash, MCP /health, and enforces static DOM/import/secret gates |
| **Notes Foundation Security Suite (NOTE-03)** | `node scripts/verify-notes-foundation.mjs` | Verifies TP-SEC-1/2 write/RPC denials, column-level security on note_authors, and settings/kinds reading |
| **Notes Core & Anchors Verification (NOTE-04)** | `node scripts/verify-notes-core.mjs` | Verifies TP-SEC-1 table write/revision denials, TP-INT-1 10-kind anchor constraints and occurrence integrity trigger, and TP-PERF-1 partial index scans on 40,000 synthetic anchors |
| **Notes Connections Verification (NOTE-05)** | `node scripts/verify-notes-connections.mjs` | Verifies TP-SEC-1 table write denials, 16 connection types vocabulary, composite note FK constraints, self-connection rejections, and anchor cascade deletion |
| **Notes Blocks Verification (NOTE-06)** | `node scripts/verify-notes-blocks.mjs` | Verifies TP-SEC-1 block write denials, 9 block types registry, polymorphic block validation, URL HTTPS/XSS safety, and dynamic enablement |
| **Notes Security Gate (NOTE-07)** | `node scripts/verify-notes-security.mjs` | Verifies TP-SEC-1/2 PostgREST write/helper denials on all 10 note* tables, catalog privileges (no anon/auth/public writes), function execution allow-list, and security definer search_path='' isolation |
| **Notes Human Write Verification (NOTE-08)** | `node scripts/verify-notes-write.mjs` | Verifies human write RPCs (save_note_v1, delete_note_v1, set_note_review_v1), Adam/Dam round-trip, byte-identical Hebrew preservation, rate limiting, kill switch, idempotency, version concurrency, and RLS soft-delete isolation |
| **Notes AI Write Verification (NOTE-09)** | `node scripts/verify-notes-agent.mjs [--print-sql]` | Verifies AI write RPCs (agent_save_note_v1, agent_delete_note_v1), service_role isolation, author resolution, per-agent rate limits, kill switch, agent ownership enforcement, 24h duplicate suppression by content_hash, and soft delete |
| **Notes Read RPCs Verification (NOTE-10)** | `node scripts/verify-notes-read.mjs` | Verifies read RPCs (get_notes_for_passage_v1, get_notes_for_word_v1, get_note_v1, list_notes_v1, list_note_connection_types_v1), primary/secondary tiers, token note counts, highest specificity scoping, homograph isolation, backlinks, revisions, keyset cursor pagination, soft-delete isolation, and TP-PERF-2 (< 300 ms) |
| **Book Aliases & Reference Parser Suite (NOTE-11)** | `node scripts/verify-book-refs.mjs` | Verifies public.book_aliases coverage (375 aliases), 66 canonical books resolvable by name and USFM, zero ambiguity, table-driven reference parsing across 63 cases, Psalm 3:0 heading, single-chapter book scoping, range validation, and anon write denials |
| **Notes Target Search Verification (NOTE-12)** | `node scripts/verify-notes-search.mjs` | Verifies search_note_targets_v1 across 15 cases (references, Strong's identifiers, H1254 homograph separation, Hebrew/Greek script, transliterations, places, concepts, notes, p_kinds filtering, SQL safety, deterministic repeats, and save_note_v1 anchor round-trip) |
| **Database Acceptance Suite & Gate G1 (NOTE-13)** | `node scripts/verify-notes-db.mjs` | Runs all 10 notes verification scripts in sequence, verifies injection payload verbatim passive storage, AI note visibility, p_author_kind filters, TP-GUARD-1 regression comparison, and TP-CLEAN-1 zero unremoved test rows |
| **Lexical Formation Ingestion ETL** | `node scripts/import-lexical-formations.mjs` | Deterministic offline/online ETL for OpenScriptures HebrewStrong and STEP TBESG compounds with field-level license exclusion and strict quarantine |
| **Orthographic Candidate Discovery** | `node scripts/generate-orthographic-candidates.mjs [queries]` | Batch consonantal candidate discovery pipeline cross-referencing documented roots, formations, and literary connections |
| **Lexical Formation Verification Suite** | `node scripts/verify-lexical-formation.mjs` | Comprehensive 37-assertion test suite verifying formations (H7501), wordplay vs candidates (H120, H127, H1818), homographs, Hebrew/Greek final letter normalization, quarantine, and idempotency |
| **Word Formation Typed API Suite** | `node scripts/verify-formation-api.mjs` | Verifies typed access, boundary limits, and input validation for `get_word_formation_v1` and `suggest_orthographic_candidates_v1` |
| **Hydrated Verse Research v2 Suite** | `node scripts/verify-hydrated-v2.mjs` | Verifies set-based SQL hydration across 7 test suites (Hebrew, Greek NT, Aramaic, homographs, large ranges, and epistemic boundaries) |
| **Word Formation Cross-Corpus Suite** | `node scripts/verify-word-formation.mjs` | Comprehensive 8-suite test verifying compounds, theophoric names, literary wordplay, roots, Aramaic, Greek, multi-verse ranges, and missing etymology preservation |
| **Word Formation & Etymology UI Suite** | `node scripts/verify-word-formation-ui.mjs` | Automated 38-check verification and Playwright acceptance suite: H7501 components, H120 wordplay vs candidates, unknown etymology, back-navigation, Hydrated v2 parity, and mobile responsive behavior |

## Shared research skill and packages

`skills/bible-research/SKILL.md` defines activation and proportionate research;
`references/tool-contracts.md` supplies packet/argument details, and
`agents/openai.yaml` declares its public MCP dependency. `integrations/` holds
portable OpenAI and Gemini CLI manifests/context. The builder produces
`.artifacts/research-plugin/bible-research` and the server workflow module.
The distributable archive is `.artifacts/research-plugin/bible-research-1.4.0.zip`.
Personal Codex skill installation and the verified `bible-research-local`
marketplace make it available on this computer; host installation/refresh is
distinct from server deployment. Gemini CLI is not installed here.

The live MCP script additionally supports `--catalog-only`, checks the default
router and expected tool inventory, and measures analysis/full parity and size
in `.artifacts/research-plugin/measurements.json`. Local transport tests cover
17 prompts, profile overrides and decimal chronology continuation IDs. The
scenario fixtures are evaluation rubrics, not completed model-provider runs.
