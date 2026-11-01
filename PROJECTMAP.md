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
| `supabase/migrations/20261101023751_geography_schema.sql` | Normalized biblical geography tables, indexes, and `SELECT`-only RLS | `geography_sources`, `places`, `place_locations`, `passage_geography`, `verse_geography` |
| `supabase/migrations/20261101023954_geography_rpc.sql` | Deterministic 5-tier context-aware geography RPC + camelCase alias | `get_verse_geography`, `"getVerseGeography"` |
| `supabase/migrations/20261101183000_geography_composition_and_era.sql` | Epistolary/prophetic provenance (`composition_location`, `audience_location`), chronological era context, and period-synchronized ancient place names (`era_gazetteer`) | `get_verse_geography`, `passage_geography`, `places` |
| `supabase/migrations/20261101032932_relationship_research_schema_and_rpc.sql` | Additive lexeme/concept/evidence-graph schema, benchmark annotations, and one-lookup RPC | `source_releases`, `lexemes`, `concepts`, `concept_aliases`, `research_nodes`, `assertions`, `assertion_evidence`, `research_relationships_v1` |
| `supabase/openapi.json` | OpenAPI 3.1.0 spec pointing to `/rest/v1/rpc/*` for ChatGPT Actions & Gemini | All 8 research RPCs, `resolve_word_id`, and versioned translation read/save/reset |
| `supabase/migrations/20261101210538_hydrated_verse_research.sql` | Additive one-call public JSON hydration under caller RLS, excluding private choices | `get_verse_research_v1` |
| `supabase/migrations/20261101211815_hydrated_occurrence_batch.sql` | Set-based occurrence hydration with a single corpus token pass for all target Strong's groups | `get_verse_research_v1` replacement |
| `supabase/migrations/20261101212136_research_function_timeouts.sql` | Bounded per-function HTTP timeouts without changing role/global limits | Hydration 10s; initial relationship evidence budget |
| `supabase/migrations/20261101212411_relationship_timeout_budget.sql` | Match the relationship function to the existing eight-second reader budget; verify public REST regression | Relationship evidence 8s |
| `supabase/functions/bible-mcp/catalog.ts` | 11 read-only MCP tools and 16 native research prompts, including direct JSON `get_verse_research` | `createResearchServer`, `researchPrompt`, `PROMPTS` |
| `supabase/functions/bible-mcp/pattern-prompts.ts` | Shared pure catalog used by MCP and browser prompt-plus-data copy | `PATTERN_PROMPTS`, `PatternName`, `patternPrompt` |
| `supabase/functions/bible-mcp/index.ts` | Stateless Streamable HTTP endpoint (`v1.3.0`) deployed to Supabase Edge Functions | `createApp`, `createDatabaseReader` |

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
| `src/ui/components/WordModal.ts` | `word-modal` | Native `<dialog>` popup displaying Strong's nr, grammar, definitions, occurrences, and relationships | `createWordModal` |
| `src/ui/components/VerseMap.ts` | `verse-reader` | Collapsible `<details open>` context-aware geography map panel with chronological era banner, composition/audience provenance cards, disputed site switcher, and symbolic/unknown guard | `createVerseMap` |
| `src/ui/components/VerseMapCanvas.ts` | `verse-reader` | Lazy-loaded MapLibre GL JS canvas (`setWorkerUrl('/geo/maplibre-gl-worker.mjs')`) with `Historical + Modern`, `Ancient Atlas` (DARE/Pelagios + Natural Earth CC0), and `Modern OpenStreetMap` modes plus era-synchronized ancient DOM markers | `createVerseMapCanvas`, `BasemapMode` |
| `src/ui/components/ChronologyPanel.ts` | `verse-reader` | Multi-model chronology panel with assertions, archaeological/textual evidence, and model switcher | `createChronologyPanel` |
| `src/ui/components/ResearchPanel.ts` | `app-shell` | Eight research tabs, including hydration and pattern prompts, plus OpenAPI/MCP guide | `createResearchPanel` |
| `src/ui/components/HydratedResearch.ts` | `app-shell` | One-call multi-verse hydration, ten shared pattern templates, full JSON/prompt copy and download, explicit samples and stale-response protection | `createHydratedResearch`, `HydratedResearchHandle` |
| `src/ui/components/RelationshipExplorer.ts` | `app-shell` | Renders disambiguated lexemes, narrative parallels, intertextual chains, and counterexample controls | `renderRelationshipExplorerView` |
| `src/main.ts` | `app-shell` | Mounts all reader, map, chronology, modal, and research components and coordinates `appState` transitions | *(Entrypoint)* |

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
| **Baseline Corpus Integrity** | `node scripts/verify-bible-import.mjs` | Whole-corpus hashes, Prompts 1–4, and word details |
| **Chronology Rollout Suite** | `node scripts/verify-chronology-rollout.mjs` | All 31,203 passage assignments across 5 models, `get_verse_chronology_v1` RPC, and denied writes |
| **Geography RPC & Milestones 1–9** | `node scripts/verify-geography-rpc.mjs` | `Acts 17:22`, `John 4:7`, `John 4:20`, `Genesis 29:10`, `Exodus 15:23`/`19:2`, `Revelation 21:2` symbolic guard, `Acts 18:1` travel, and `getVerseGeography` alias |
| **Geography UI Contract Suite** | `node scripts/verify-geography-ui.mjs` | `VerseMap.ts`, `VerseMapCanvas.ts`, `styles-map.css`, and Milestone Tests 1–9 |
| **Relationship Evidence RPC** | `node scripts/verify-research-rpc.mjs` | `well` -> `marriage` (Gen 24, 29, Exod 2 + Gen 21/26 controls), `menorah` -> `seven spirits of God` (Exod 25, Zech 4, Rev 4:5/5:6 + Rev 1:20 control), and `H1254` homographs |
| **OpenAPI 3.1.0 & PostgREST** | `node scripts/verify-openapi.mjs` | Validates `supabase/openapi.json` and tests all 8 live PostgREST endpoints |
| **Public MCP Edge Function** | `node scripts/verify-bible-mcp.mjs` | End-to-end verification of all 11 read-only tools and 16 MCP prompts on `bible-mcp` |
| **Translation RPC and ownership** | `node scripts/verify-translations.mjs`, then execute generated `.artifacts/stepbible/verify-translation-ownership.sql` via MCP | Source-inflected English, sequence parity, denied anonymous writes, rollback-only private save/reset and two-reader RLS tests |
| **Translation browser acceptance** | `node scripts/verify-translations-ui.mjs` with `PLAYWRIGHT_MODULE` and optional `BROWSER_EXECUTABLE` | Source rows, options, RTL/LTR, mobile, offline labels, real private reload/reset and repeated-word isolation; reports pending when anonymous sign-in is disabled |
| **Hydrated research RPC** | `node scripts/verify-hydrated-research.mjs`; optional `--stress-only`; `scripts/verify-hydrated-research.sql` via MCP | Source parity, full occurrence lists/counts, top-seven ranking, homographs, heading, symbolic geography, reviewed evidence, validation, caller privileges, packet size and public HTTP stress |
| **Hydrated research browser** | `node scripts/verify-hydrated-ui.mjs` with `PLAYWRIGHT_MODULE` and optional `BROWSER_EXECUTABLE` | One-call batches, ten templates, full JSON/prompt copy/download, explicit samples, offline errors, stale responses, keyboard and mobile |
| **Hydrated OpenAPI schema** | `node scripts/update-hydrated-openapi.mjs`; `node scripts/verify-hydrated-schema.mjs`; `node scripts/verify-openapi.mjs --hydration-only` | Reproducible OpenAPI generation, JSON Schema 2020-12 validation against the full browser-exported live packet, strict input boundaries and public RPC |
| **MCP local transport regression** | Deno run with `.artifacts/mcp-tools/deno.json` on `scripts/verify-bible-mcp-local.mjs` | Eleven read-only tools, sixteen native/compatibility prompts, direct hydration, input rejection, credential isolation, pagination and bounded retries |
