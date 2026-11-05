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
