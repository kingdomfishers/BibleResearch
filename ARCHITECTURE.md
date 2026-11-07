# ARCHITECTURE.md — System Blueprint & Operational Contracts

Updated: 2026-11-01. Companion docs: [CHRONOLOGY_ARCHITECTURE.md](CHRONOLOGY_ARCHITECTURE.md), [CHRONOLOGY_API.md](CHRONOLOGY_API.md), [RELATIONSHIP_ARCHITECTURE.md](RELATIONSHIP_ARCHITECTURE.md), [RESEARCH_API.md](RESEARCH_API.md), [RELATIONSHIP_SCORING.md](RELATIONSHIP_SCORING.md), [DATA_SOURCES.md](DATA_SOURCES.md), [ROLLOUT.md](ROLLOUT.md).

## 1. System Overview & Core Principles

A high-performance, database-first Bible research application built with **Vite**, **Vanilla TypeScript**, **MapLibre GL JS**, and **Supabase (PostgreSQL)**.

1. **100% Database-Native Prompts & Context Resolvers (RPCs):** All 8 research RPCs and context resolvers, including `get_verse_research_v1`, execute directly inside PostgreSQL in a single round-trip.
2. **Shared PostgREST & Public MCP Surface:** Supabase exposes SQL RPC functions as REST endpoints (`/rest/v1/rpc/<prompt_name>`) documented in `supabase/openapi.json` (OpenAPI 3.1.0). The `bible-mcp` Supabase Edge Function exposes 11 read-only tools and 17 native MCP prompts (seven study/workflow templates plus ten pattern templates) over stateless Streamable HTTP without user authentication.
3. **Read-Only Security via RLS:** All corpus, chronology, geography, and relationship tables enforce `SELECT`-only Row Level Security (RLS) for `anon` and `authenticated` roles, hiding candidate/draft records and denying client-side writes.
4. **Zero-Bloat Frontend & Era-Aware Historical/Modern Map:** Vanilla TypeScript + Vite with lazy-loaded MapLibre GL JS (`/geo/maplibre-gl-worker.mjs`), switching between **Historical + Modern Hybrid**, **Ancient Historical (CAWM / Physical Terrain)**, and **Modern OpenStreetMap** basemaps, rendering both active verse locations (including `composition_location` where written and `audience_location` to whom addressed) and an **era-synchronized ancient biblical gazetteer** matched to the chronological time of the selected verse.

## Reader extension: private occurrence translations

The user requested word-by-word English under every original token and approved
private saved choices per verse occurrence and implementation on 2026-11-01;
see [the concrete design](WORD_TRANSLATION_DESIGN.md).

Use the pinned STEP occurrence rendering as the default and retain its English
inflections, articles, attached prepositions, conjunctions, and pronouns. Offer
all available source renderings for the same original form and morphology in an
English dropdown. Preserve original-token clicks for the existing inspector.
Tokens with no independent English rendering need an explicit grammatical label.

Occurrence-gloss storage, caller-owned translation preferences protected by
RLS, and versioned read/save/reset RPCs are deployed. All ordering, validation, and preference
hydration remain in PostgreSQL. Keep the legacy public RPC contracts intact.
The owner identity is a persistent anonymous Supabase Auth session;
browser reload persistence does not imply cross-device account recovery.
Corpus tables remain read-only; preferences are the new owner-writable exception.
The reader uses `get_verse_translations_v1`; writes use `save_word_translation_v1`
and `reset_word_translation_v1`. Private saving requires anonymous sign-in enabled
in Supabase Auth. The source import covers 443,524 tokens in 31,203 verses.

## Hydrated verse AI research (approved 2026-11-01, updated 2026-11-02)

[AI_RESEARCH_DESIGN.md](AI_RESEARCH_DESIGN.md) defines the additive
`get_verse_research_v1` JSON RPC, one-call public MCP hydration, and ten deeper
pattern research prompts. It reuses source translations, word statistics,
chronology, geography, and available reviewed semantic evidence in PostgreSQL.
The design explicitly distinguishes complete occurrence references, opt-in
samples, base-Strong's identity, semantic annotation gaps, and private reader
choices.

In the 2026-11-02 optimization release:
1. **Contiguous Verse Ranges & Batch Expansion:** Supports contiguous passage
spans (`{ book, chapter, start_verse, end_verse }`) alongside discrete verses,
expanding the pericope batch limit up to **100 verses max** under `profile: "analysis"`.
2. **Top-Level Payload Deduplication:** Repetitive metadata (`chronology`,
`geography`, and `semantic_evidence`) is hoisted out of individual verse objects into
top-level dictionaries keyed by verse reference string (`"{book}:{chapter}:{verse}"`),
compressing packet payloads by ~60–70%.
3. **Server-Side Grammar Decoding:** PostgreSQL's `decode_grammar_v1(code)`
automatically decodes raw Hebrew and Greek morphological tags into structured
JSON properties (`pos`, `stem`, `aspect`, `gender`, `number`, `state`, etc.).
4. **Polysemy & Homograph Preservation:** Candidate lexemes sharing base Strong's
numbers across distinct semantic domains (e.g. `H5869a` eye vs `H5869b` spring;
`H1254a`/`b`/`c`) are strictly retained in `lexical_entries` to enable the exploration
of deliberate theological and linguistic design (paronomasia/conceptual stacking).
5. **Statement Timeout Budget:** Configured with a function-scoped 15s budget
(`set statement_timeout = '15s'`) without altering global or role limits.

## Proposed Septuagint word connections (2026-11-02)

The user requested direct Hebrew–Greek links through the Septuagint.
[SEPTUAGINT_DESIGN.md](SEPTUAGINT_DESIGN.md) proposes bidirectional,
source-attested lexical correspondences in the word inspector and public
research API. MACULA Hebrew's licensed Greek-equivalent fields are the initial
source candidate, subject to a pinned payload/coverage audit. This extension
requires additive database evidence storage and a versioned read-only RPC;
architecture approval is pending under the pre-code protocol. Do not claim
full LXX token alignment or merge cross-language lexical identities.

## Word Gematria (Hebrew & Greek Standard)

Each lexical word record in `public.words` provides database-computed `gematria integer`.
Calculated via an immutable PostgreSQL function `public.calculate_gematria(text)`:
1. Normalizes text with `normalize(p_word, NFKD)` and lowercases it.
2. Strips Hebrew vowels/accents (`[\u0591-\u05C7]`), Greek diacritics (`[\u0300-\u036F]`), and non-alphabetic characters.
3. Computes Standard Hebrew Gematria (א=1..ת=400 with standard final forms ך=20, ם=40, etc.) and Standard Greek Isopsephy (α=1..ω=800, ϛ=6, ϟ=90, ϡ=900).
4. Returned in `WordRecord` and rendered inside the Word Inspector modal metadata.

## Shared research workflow (approved 2026-11-02)

`skills/bible-research/SKILL.md` is the canonical portable research procedure.
`scripts/build-research-plugin.mjs` packages that same skill for OpenAI plugins
and Gemini CLI extensions and generates the MCP-readable workflow module.
The MCP server exposes `study_bible` through both native prompts and the existing
`get_research_prompt` tool (the default when name is omitted). Existing prompts
remain compatible. Short server instructions route multi-step research into
this workflow; simple lookups can call their relevant data tool directly.

`get_verse_research` accepts an optional MCP-only delivery `profile`: `full`
(the compatibility default) or `analysis` (five occurrence references per word
by default). Explicit `p_request.occurrences` always wins. Profile selection only
supplies existing RPC parameters; exact totals, coverage flags, hydration,
ranking and joins remain in PostgreSQL. No database or REST signature changes.
Analysis mode never claims exhaustive occurrence references. Skill instructions
honor the user's requested completeness and response format and expand research
only when the question requires it.

Package metadata and all deployment inputs contain the public HTTPS MCP URL,
not administrative credentials. Client catalog refresh and skill installation
are separate from deploying the server. Behavioral fixtures provide a rubric
for both clients; contract tests do not substitute for actual model evaluations.

## 2. Directory Structure

```text
├── .agents/skills/             # pre-code & post-code verification skills
├── data/
│   ├── annotations/            # Reviewed literary & intertextual motif annotations
│   ├── chronology/             # Reference mappings, context estimates & evidence
│   └── geography/              # Curated narrative passage geography contexts
├── public/geo/
│   └── ancient-basemap.geojson # Self-hosted Natural Earth CC0 vector basemap
├── scripts/                    # Offline ETL, hash audits, and live verification suites
├── supabase/
│   ├── functions/bible-mcp/    # Public Streamable HTTP MCP Edge Function (v1.3.0)
│   ├── migrations/             # Additive PostgreSQL schema & RPC migrations
│   └── openapi.json            # OpenAPI 3.1.0 specification for ChatGPT & Gemini
└── src/
    ├── api/
    │   ├── supabase.ts         # Single Supabase client instance
    │   ├── types.ts            # Canonical TypeScript interfaces for all packets
    │   └── rpc.ts              # Single BibleRPC gateway + LRU geography cache
    ├── ui/
    │   ├── components/
    │   │   ├── NavSelector.ts          # Book / Chapter / Verse + chronology badge
    │   │   ├── VerseReader.ts          # Interlinear RTL/LTR token reader
    │   │   ├── TranslationChoice.ts    # Private English dropdown, save/reset/status
    │   │   ├── WordModal.ts            # Word occurrences & relationships dialog
    │   │   ├── VerseMap.ts             # Collapsible context-aware geography panel
    │   │   ├── VerseMapCanvas.ts       # Lazy-loaded MapLibre GL JS canvas
    │   │   ├── ChronologyPanel.ts      # Multi-model chronology & evidence panel
    │   │   ├── ResearchPanel.ts        # Interactive 8-tool / 10-pattern AI console
    │   │   └── RelationshipExplorer.ts # Evidence graph & homograph explorer
    │   ├── state.ts            # URL-hash (#book-chapter-verse) reactive store
    │   ├── styles.css          # Core typography & layout styles
    │   ├── styles-chronology.css
    │   └── styles-map.css
    └── main.ts                 # Top-level application shell
```

## 3. Canonical Biblical Lexical & Evidence Database (2026-11-05)

Extends the PostgreSQL data layer additively (preserving all existing tables, IDs, and RPCs) to model biblical vocabulary, editions, versification, morphology, syntax, external factual knowledge, and sourced evidence relationships without conflation or AI-generated assignments:

1. **Strict Entity Separation (Modeling Invariants):**
   - **Inflected Word Form (`public.words`):** Surface orthography + grammar tag (`150,105` forms); linked via `public.word_form_lemmas` to morphemes/lemmas—never treated as a lemma.
   - **Canonical Lemma (`public.lemmas`):** Dictionary headword (`hbo`/`arc`/`grc`) preserving homograph indices (`H1254A`/`B`/`C`, `H5869a`/`b`).
   - **Lexical Entry (`public.lexemes` + `public.lexeme_identifiers`):** Edition-specific lexicon entries (`TBESH`/`TBESG`) and namespaced identifiers (`base_strongs`, `extended_strongs`, `disambiguated_strongs`, `unified_strongs`).
   - **Documented Root (`public.lexical_roots` + `public.lemma_root_links`):** Etymological roots/stems and documented derivations (`TBESH`/`TBESG` `dStrong -> uStrong` and Abbott-Smith Greek derivations). Roots carry no "root meaning" column, and shared-root words are never automatically marked synonymous.
   - **Lexical Sense (`public.lexical_senses`):** Source-attributed sense definitions (`TBESH` CC BY gloss/sense subdivisions, excluding restricted Online Bible `TBESH` column 7; `TBESG` CC BY glosses and Abbott-Smith/Middle Liddell numbered senses).
   - **Translation Glosses & Choices (`public.verse_translation_sources`, `public.reader_rendering_groups`, `public.word_translation_choices`):** Attested contextual English renderings and owner-scoped private choices, kept separate from lexical senses and without claiming English word-for-word alignment.
   - **Passages & Versification (`public.verses`, `public.source_editions`, `public.edition_passages`, `public.versification_mappings`):** Explicit Masoretic Hebrew (`TAHOT` `Eng(Heb)`), Psalm superscription, KJV bracket (`TAGNT`), and `webp-2026-11` mappings.
   - **Syntax & Semantic Annotations (`public.token_morphemes`, `public.syntax_nodes`, `public.syntax_edges`, `public.semantic_annotations`):** Morpheme segmentation (`TAHOT`), Greek grammatical dependency chains (`TAGNT` `Conjoin word`), and source-tagged sub-meaning labels (`origin_mode = 'directly_imported'`).
   - **External Concepts & Evidence Graph (`public.concepts`, `public.concept_properties`, `public.concept_external_links`, `public.research_nodes`, `public.relation_types`, `public.entity_relationships`):** External factual properties/URIs (`epistemic_layer = 'external_factual'`) separated from primary biblical observations and reviewed/user-authored interpretations. Every relationship stores `source_release_id`, `source_edition_id`, `source_record_id`, `relation_type`, supporting span/citation, `origin_mode` (`directly_imported` | `algorithmically_calculated` | `user_authored`), `derivation_method`, and `algorithm_version`.

2. **Deterministic Lookup RPCs (`SECURITY INVOKER`, `SET search_path = ''`, `8s` timeout):**
   - `lookup_word_to_lemma_senses_v1(p_word_id, p_query)` — Original word form $\to$ canonical lemma(s) $\to$ documented lexical senses.
   - `lookup_lemma_occurrences_v1(p_lemma_query, p_after_verse_id, p_limit)` — Lemma $\to$ exact corpus totals + paginated occurrences across all inflected forms.
   - `lookup_lemma_root_relatives_v1(p_lemma_query)` — Lemma $\to$ documented roots, etymological links, and root-relative lemmas (explicitly non-synonymous).
   - `lookup_lemma_english_glosses_v1(p_lemma_query, p_limit)` — Lemma $\to$ attested corpus occurrence glosses distinguished from lexicon sense glosses.
   - `lookup_passage_tokens_syntax_v1(p_book, p_chapter, p_verse, p_edition_key)` — Passage $\to$ versification mappings, ordered tokens, morphemes, decoded morphology, syntax nodes/edges, and sourced semantic annotations.
   - `lookup_concept_properties_v1(p_concept_query)` — Concept $\to$ definitions, aliases, documented external properties, and verified hyperlinks.
   - `lookup_entity_relationships_v1(p_entity_query, p_relation_type, p_origin_mode, p_limit)` — Entity $\to$ directly documented relationships with complete provenance metadata.


## 4. Notes & Connections Layer (approved 2026-11-07, single-user mode)

Plan, test points, gates, and step-by-step prompts: `TASKS.md` → "Feature: Notes & Connections Layer (NOTE)". Schema/RPC detail: [DATA_MODEL.md](DATA_MODEL.md) §5. Status: specified; nothing deployed until NOTE-03+.

1. **Separate epistemic layer.** Notes are commentary/interpretation (`epistemic_layer = 'user_note'`). They never write into corpus or evidence tables (`entity_relationships`, `semantic_annotations`, `concepts`, ...), never change evidence counts, and every API/MCP output labels them with `epistemic_layer`, `author_kind` and `review_status`. Notes are never cited as source evidence. Any future promotion to `reviewed_interpretation` is an explicit, separate workflow.
2. **One note, many anchors, typed connections.** A note is content plus anchors (`verse`, `verse_range`, `word_occurrence`, `word_form`, `lemma`, `concept`, `place`, `event`, `note`, `external`). Optional `note_connections` link two anchors of the *same* note with an optional type from a user-extendable vocabulary (`note_connection_types`) and a direction (`directed` | `bidirectional` | `undirected`). Example: Adam/Dam = one note, word anchors for `דַּם` (`H1818`) and `הָאָדָם` (`H120`), and one `linguistic / contained_in` connection (dam -> adam).
3. **Verse display tiers.** Primary tier: `verse`, covering `verse_range` and `word_occurrence` anchors in the verse. Secondary (collapsed) tier: `word_form` / `lemma` matches with matching token positions, so a note on a common word does not flood every verse. Word inspection shows occurrence, form and lemma scope notes plus connections where the word is the other endpoint.
4. **Flexible content.** `notes.body_md` (always present, searchable, AI-readable) plus ordered `note_blocks` validated by a `note_block_types` registry (`markdown`, `link`, `image` by HTTPS URL enabled in v1; `map`, `timeline`, `model_3d`, `archaeological_find`, `table`, `chart` registered as `planned`). Every block has a required `text_alternative`. Clickable parts of a visual are anchors carrying `block_id` + `element_ref`, so word -> notes lookup keeps working.
5. **Single-user mode now, multi-user ready (`S1`–`S11`).** No login UI or Supabase Auth is required yet: everyone who reaches the app acts as the seeded human admin author (`"You"`), resolved through `note_resolve_human_author_v1()` while `note_settings.single_user_mode = true`. Future multi-user support flips `single_user_mode = false` and maps `auth.uid()` to `note_authors.user_id` without changing schema or UI contracts.
6. **Safety nets & DB-enforced provenance.** `note_settings` provides single-row kill switches (`human_writes_enabled`, `ai_writes_enabled`), size/anchor/block caps, and hourly rate limits counted from `note_revisions`. Direct table writes are revoked from `anon`/`authenticated`. Human writes call `save_note_v1` (`SECURITY DEFINER`, callable by `anon`, forces `author_kind = 'human'`); AI writes call `agent_save_note_v1` (callable **only** by `service_role` from the `bible-mcp` Edge Function, forces `author_kind = 'ai'` and `review_status = 'unreviewed'`, and allows an AI agent to edit/delete only its own notes). If Edge env `NOTES_AGENT_KEY` is set, MCP write tools require `Authorization: Bearer <key>`; if unset, MCP writes are open in single-user mode.
7. **SQL-first, versioned contracts.** Tier resolution, scope matching, reference parsing (`book_aliases` + `parse_bible_ref_v1`), target search (`search_note_targets_v1`), validation and writes are PostgreSQL RPCs (`*_v1`, reads `SECURITY INVOKER`, `search_path = ''`, statement timeouts, keyset pagination). TypeScript (`src/api/notes-rpc.ts`, merged into `BibleRPC`) and the MCP adapter stay thin. UI never imports `supabase.ts` directly.
8. **AI read/write surface.** `get_verse_research` gains `include_notes` (default true, capped per verse with `notes_total`); new read-only MCP tools `get_notes`, `search_note_targets`, `list_note_connection_types`; new write tools `create_note`, `update_my_note`, `delete_my_note`. All note text is structurally marked as untrusted data (`untrusted_notes` + `notice`) to guard against prompt injection.
9. **UI rules.** Human vs AI is visible without relying on color alone (solid vs dashed start border + person vs sparkle icon + `"You"` vs `"AI · {model}"` pill + review status + screen-reader label; separate human/AI token-badge shapes; one-click hide-AI filter). Note content is rendered with DOM APIs only (never `innerHTML`) through an in-house safe markdown renderer (`src/ui/note-markdown.ts`). Components (`NoteCard`, `NotesPanel`, `WordNotes`, `NoteEditor`, `TargetPicker`, `ConnectionBuilder`, `NoteBlocks`, `NotesBrowser`) communicate through `notes-state.ts`/callbacks and deep-link with `#note=<id>`.
