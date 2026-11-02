# RESEARCH_API.md — One-Lookup Relationship & Evidence Graph Contract

Updated: 2026-11-01. Architecture: [RELATIONSHIP_ARCHITECTURE.md](RELATIONSHIP_ARCHITECTURE.md).

## 1. Endpoint & Invocation

For complete verse context use the new `get_verse_research_v1` endpoint below.
The existing relationship graph contract remains compatible.

- **PostgreSQL RPC:** `public.research_relationships_v1(p_request jsonb) returns jsonb`
- **PostgREST Endpoint:** `POST /rest/v1/rpc/research_relationships_v1`
- **Public MCP Tool:** `research_relationships` (`https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp/mcp`)
- **Public MCP Prompt:** `study_relationships`
- **Frontend Gateway:** `BibleRPC.researchRelationships(request)` in `src/api/rpc.ts`

## 2. Request Contract

```json
{
  "subject": { "text": "well" },
  "target": { "text": "marriage" },
  "mode": "explain",
  "corpus": "primary",
  "limits": { "paths": 10, "evidence_per_path": 3, "max_hops": 3 }
}
```

- Also supports single-subject `discover` mode (`{"subject": {"text": "H1254"}}` or `{"subject": {"text": "menorah"}, "target": {"text": "seven spirits of God"}}`).

## 3. Response Contract (`schema_version: 1`)

- `resolution`: Resolved `subject_concepts`, `target_concepts`, disambiguated `subject_lexemes` (preserving homographs such as `H1254a`/`b`/`c` and `H0430G`/`a`), `target_lexemes`, and `needs_disambiguation`.
- `evidence_paths`: Ordered, source-attributed assertions with `epistemic_category` (`lexical`, `linguistic`, `statistical`, `textual`, `interpretive`), `predicate`, `scope_reference`, `denominator_note`, `summary`, `limitations_note`, and ordered `evidence_spans` (each with canonical `book`, `start_chapter`, `start_verse`, `original_terms`, `explanation`, and `step_url`).
- `controls_and_distinctions`: Explicit counterexamples and contextual distinctions (e.g., `Genesis 21:19` and `Genesis 26:18-33` non-marriage wells; `Revelation 1:20` seven lampstands = seven churches).
- `statistical_cooccurrences`: Live corpus co-occurrence statistics when the subject resolves to a lexical word.
- `coverage`: Corpus denominator (`31,203` passages, `443,524` tokens) and `51,200`-byte cap metadata.

## 4. One-call hydrated verses (v1.3.0)

- REST: `POST /rest/v1/rpc/get_verse_research_v1`
- Public MCP tool: `get_verse_research`
- Frontend gateway: `BibleRPC.getVerseResearch(request)`
- UI: Research panel → **8 · Hydrated Verse & Patterns**

REST and MCP use the same arguments:

```json
{
  "p_request": {
    "passages": [
      { "book": 1, "chapter": 1, "verse": 1 },
      { "book": 43, "chapter": 1, "verse": 1 }
    ],
    "occurrences": { "mode": "all" },
    "chronology_model_id": "theographic-verse-v1"
  }
}
```

Request 1-5 distinct verses, including retained Psalm headings at verse 0. The
MCP tool returns the packet directly as structuredContent (rather than a paged
rows envelope). The gateway receives the inner request object without p_request.

`verses[].words` preserves every token's position, source English rendering,
available translations, original form, transliteration, Strong's, raw grammar
and source scheme, definitions, and available lexeme candidates.
`words[].lexical_entry_key` points into shared `lexical_entries`, where each
base-Strong's group has exact corpus token and passage totals, every occurrence
reference/count by default, and its top seven available cached connections with
translations, definitions, scores, frequency and distance. Repeated words retain
independent occurrence information while sharing corpus statistics.

Each verse also contains the existing `chronology` and `geography` packets
(including alternatives, provenance, coordinates/bounds, ancient names and
composition/audience locations where supplied), plus relevant reviewed
`semantic_evidence` and counterexamples. Top-level sources identify the lexical
and annotation releases; nested chronology/geography retain their own sources.

Raw grammatical tags remain in `unresolved_tags` until a verified decoder is
available; decoded_features is currently empty. Semantic domains and token-sense
assignments are unavailable. Lexeme candidates preserve homographs and are not
assigned senses. Semantic evidence matches include passage spans and lexically
related concept candidates; inspect the citations before asserting a pattern.
Empty annotation arrays do not establish that no relationship exists.

`coverage` declares occurrence completeness, chronology evidence completeness,
component statuses, source scope and resource limits. Base-Strong's aggregation
groups inflections and may combine homographs; cached scores measure corpus
associations, not synonymy or theological proof. Public hydration excludes private
translation choices even when called by an authenticated reader.

Use `"occurrences":{"mode":"sample","limit":20}` only when a sample is wanted.
The maximum sample limit is 100. Samples retain exact totals and explicitly
declare incomplete references. No occurrence verse is recursively hydrated.
The maximum JSON packet is 8 MiB; oversized results return
`packet_limit_exceeded` with measured bytes and a smaller-request/sample hint.
Other packet errors are `invalid_request` and `passage_not_found`. Inspect nested
component errors and evidence cursors before claiming complete dating/map data.
Hydration has a function-scoped 10s database budget within the 12s client budget;
the existing relationship evidence function has an 8s budget. Role and global
timeouts remain unchanged.

## 5. Deep pattern prompts

Public MCP v1.4.0 exposes 11 read-only tools and 17 native prompts: the existing
six study templates, ten patterns and the general study_bible workflow. Retrieve any template with
`get_research_prompt({name,subject})` or MCP prompts/get. UI prompt-plus-data copy
uses the same shared pattern catalog and includes the complete fetched packet.

| Prompt | Focus |
| --- | --- |
| `find_repetition` | Repeated lexemes, forms, clusters and inclusions |
| `find_literary_structure` | Parallelism, inclusio and competing chiasm proposals |
| `trace_motifs` | Recurring scenes, sequences, participants and outcomes |
| `test_intertextuality` | Quotations, possible allusions and distinctive overlap |
| `compare_semantic_contrasts` | Contextual lexical contrasts and candidate senses |
| `trace_grammatical_shifts` | Supported morphological changes and unresolved tags |
| `find_rare_connections` | Cached associations, denominators and common-word effects |
| `trace_patterns_in_time_and_place` | Historical settings, chronology models and geographical uncertainty |
| `compare_translation_effects` | Patterns that depend on English rendering choices |
| `challenge_pattern` | Falsifiable claims, counterexamples and alternatives |

Templates request observations, candidate_patterns, evidence, counterexamples,
alternative_explanations, uncertainty, coverage, and next_checks as JSON. Every
candidate needs verse/token citations, an epistemic category and a qualitative
confidence explanation. Templates guide AI analysis; they do not claim that a
literary pattern is already verified by a discovery algorithm.

## 6. Shared skill and optimized research workflow (v1.4.0)

`skills/bible-research/SKILL.md` is the canonical skill. The package builder
generates the server-readable version and copies the same source into portable
OpenAI/Gemini CLI packages. For substantial research, retrieve
`get_research_prompt({subject:"..."})` once; name defaults to `study_bible`.
The result adds workflow metadata: version, expected tool names, profiles and
intent routes. Simple token/date/place lookups can call their data tool directly.
The previous sixteen prompt names remain supported.

The MCP hydration tool accepts an optional top-level profile:

```json
{
  "profile": "analysis",
  "p_request": { "passages": [{ "book": 43, "chapter": 1, "verse": 1 }] }
}
```

Analysis supplies `occurrences:{mode:"sample",limit:5}` only when that field is
omitted. All requested verse tokens, translations, raw grammar, definitions,
chronology, map data and reviewed semantic evidence remain hydrated. Exact corpus
totals and top connections remain unchanged. Coverage explicitly identifies
incomplete occurrence references. Full is the default for existing clients;
explicit occurrence settings always override a profile, including all references
under analysis or a reader-chosen sample under full. No server-side joins or
statistics move out of PostgreSQL. REST callers keep their existing request.

Workflow guidance matches the reader's requested output instead of always
forcing JSON. It distinguishes textual observations, statistical measurements,
reviewed annotations and interpretation; asks for controls when testing a
pattern; preserves missing semantic/grammar evidence; and does not infer
cross-edition alignment or theological proof from lexical/numerical resemblance.
Chronology continuation accepts returned decimal run IDs rather than UUIDs.

Validation includes local profile/default/override and catalog contracts, skill
validation, official portable manifest schemas, browser copying/export behavior,
and 14 groups of live MCP checks. John 1:1 analysis/full comparison measured
242,204 versus 1,274,531 structured JSON bytes (81% smaller) with evidence/totals
parity. The 22 cases in `scripts/fixtures/research-workflow-cases.json` provide
an activation/quality rubric for actual ChatGPT/Gemini evaluations; they do not
represent completed provider runs.

Verification: `node scripts/verify-hydrated-research.mjs`,
`node scripts/verify-openapi.mjs --hydration-only`,
`node scripts/verify-bible-mcp.mjs`, and
`node scripts/verify-hydrated-ui.mjs` (with PLAYWRIGHT_MODULE/BROWSER_EXECUTABLE).
`node scripts/verify-hydrated-schema.mjs` checks the full exported packet using
Ajv 8 JSON Schema 2020-12; AJV_MODULE can select an existing installation.
