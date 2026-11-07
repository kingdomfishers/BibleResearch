# ARCHITECTURE.md — System Blueprint & Operational Contracts

Updated: 2026-11-07 (MACULA licensing boundary); original operational contract 2026-11-01. Companion docs: [CHRONOLOGY_ARCHITECTURE.md](CHRONOLOGY_ARCHITECTURE.md), [CHRONOLOGY_API.md](CHRONOLOGY_API.md), [RELATIONSHIP_ARCHITECTURE.md](RELATIONSHIP_ARCHITECTURE.md), [RESEARCH_API.md](RESEARCH_API.md), [RELATIONSHIP_SCORING.md](RELATIONSHIP_SCORING.md), [DATA_SOURCES.md](DATA_SOURCES.md), [ROLLOUT.md](ROLLOUT.md).

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

## MACULA licensing and private research boundary (2026-11-07)

**Intent:** BibleResearch is currently for the owner's research. This is NOT proof
that its deployed code or data are private, nor does internal use automatically
override third-party copyright or license terms.

**Observed deployment exposure on 2026-11-07:**
- GitHub repository `kingdomfishers/BibleResearch` is **public**.
- The deployed `bible-mcp` Supabase Edge Function has JWT verification
  disabled; its implementation declares unauthenticated MCP access and
  uses Supabase's publishable/anon credentials.
- The `public.macula_gated_field_values` RLS policy admits rows for
  `anon`/`authenticated` whenever `public.field_is_enabled` returns true.
  That function treats both `enabled` and `enabled_origin_unverified`
  as enabled; the last category is **not** private-only.
- The `public.entity_relationships` reviewed-evidence and
  `public.hebrew_lxx_word_alignments` tables currently have public read
  policies. Changing the gate alone will not necessarily suppress derived
  equivalents or cached alignments. Review every dependent RPC/view/API.
- Do not describe these endpoints/data as private until authentication,
  role isolation and public-API leakage checks have been implemented and
  verified. Supabase service/secret keys must never enter the browser.

**Source records and current field decisions:**
- MACULA Hebrew (`macula-hebrew-47db250`, pinned upstream commit
  `47db250bd55d0d8577f2a94fba114ef16c35b23c`): `greek` (1,084
  stored values) and `greekstrong` (1,010) are currently
  `enabled_origin_unverified`. MACULA's dataset-level CC BY 4.0 license
  mentions Greek equivalents, but the upstream derivation of these exact
  fields has not been confirmed. Possible third-party alignment rights,
  including CATSS, must be checked before wider redistribution.
- MACULA Hebrew `frame` (200 stored values) remains
  `disabled_unverified`: the recorded origin is inconclusive, potentially
  overlapping separately licensed semantic-frame data. Retain source bytes
  for internal source auditing only; do not set this field to publicly enabled
  merely because the project is intended to be private.
- The 383 `source_provided_lexical_equivalent` relationships recorded
  against source release 7 require dependency/provenance review. Lexical
  equivalents are not necessarily token-to-token Hebrew–Greek alignments.
- UBS SDBH-derived Hebrew semantic-domain fields and Greek UBS MARBLE /
  Louw–Nida fields remain `disabled_restricted`; dataset-level MACULA
  licensing does not supersede separate third-party permissions.
- Swete LXX is separately attributed under CC BY-SA 4.0; maintain applicable
  ShareAlike requirements for distributions/adaptations of that material.

**Internal-use rule:** Preserve these fields and provenance in the database for
trusted research and rights auditing. Data hidden from `anon` by RLS can
already be inspected by a privileged database administrator; that is not a
license to expose it through public RPCs or an unauthenticated MCP endpoint.
Any new owner-only UI/API requires real authorization (not merely anonymous
Supabase Auth) plus tests showing these fields and **all derived data** are
absent from public/anonymous responses. Do not silently promote uncertain
source relationships to verified biblical facts.

**Before public distribution or release:**
1. Obtain and archive written field-specific provenance/rights clarification
   from the upstream maintainers for `greek`, `greekstrong`, and `frame`;
   identify any independently restricted inputs and permissions.
2. Audit the current GitHub visibility, public web deployments, Supabase RLS,
   table grants, views, SQL RPCs and no-JWT MCP/Edge functions. Restrict
   anything described as internal-only, including materialized or derived
   Hebrew–Greek relationships and cached outputs.
3. Apply the final rights decisions to `field_license_registry`, reimport
   from pinned permissible sources when necessary, and run negative exposure
   tests as both `anon` and `authenticated` (including anonymous sign-ins).
4. Publish accurate source attribution, versions, license links and the
   applicable CC BY 4.0 / CC BY-SA 4.0 notices; preserve field-level
   provenance and provide a separate data/license export policy.
5. Re-run representative original-language, cross-language, evidence
   provenance, authorization and regression tests before changing exposure.

**Status:** Documentation of the provisional internal-research intention;
**NOT** a clearance to publish, and **NOT** a change to database permissions
or the deployed application security controls.

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
