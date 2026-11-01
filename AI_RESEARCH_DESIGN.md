# Hydrated verse research and deeper pattern prompts

Status: approved and implemented on 2026-11-01. The user approved this design
before implementation. The database RPC and public MCP are deployed; the local
reader includes the Hydrated Verse & Patterns tab. See RESEARCH_API.md for usage.

## Intended result

An AI can request one or several verses once and receive one JSON object with
ordered words, translations, grammar, word occurrences, seven ranked word
connections, chronology, geographical map data, and available semantic evidence.
The UI, OpenAPI, and public Bible MCP expose the same database-native contract.
Existing tools and RPCs remain compatible.

## Audited baseline

Live RPC signatures were inspected through Supabase MCP. Available functions are
`prompt_verse_words`, `prompt_word_occurrences`, `prompt_word_cooccurrences`,
`prompt_word_relationships`, `get_verse_translations_v1`,
`get_verse_chronology_v1`, `get_verse_geography`, and
`research_relationships_v1`.

The live database has 443,524 source translation tokens, but the curated semantic
layer currently has only 13 lexemes, 7 assertions, and 13 evidence spans. These
are different coverage levels. The packet must not imply that every word has a
disambiguated dictionary entry, semantic domain, sense annotation, or reviewed
literary relationship. Source grammar codes are available; expanded grammatical
labels must use a verified tag mapping and leave unsupported tags explicit.

`words`/`verses` remain the complete primary token source. Reuse existing
translation options, chronology, geography, and evidence structures. Do not
implement an AI model call inside PostgreSQL or call the relationship graph once
per word; hydrate relevant reviewed evidence with a set-based SQL query.

## Request contract

Add `public.get_verse_research_v1(p_request jsonb) returns jsonb` and MCP tool
`get_verse_research`. Example:

```json
{
  "passages": [
    { "book": 1, "chapter": 1, "verse": 1 },
    { "book": 43, "chapter": 1, "verse": 1 }
  ],
  "occurrences": { "mode": "all" },
  "chronology_model_id": "theographic-verse-v1"
}
```

- Accept 1-5 distinct explicit references, in request order; allow retained Psalm
  headings at verse 0. Validate against the actual corpus.
- Default occurrence mode is `all`: include every matching passage reference and
  its occurrence count for each base Strong's group, plus corpus token and
  distinct-passage totals. Counts and references are computed in PostgreSQL.
- Optional `sample` mode accepts `limit` from 1-100, default 20. Return exact
  totals and an explicit completeness flag; never imply a sample is exhaustive.
- Each distinct Strong's group is hydrated once across the packet. Every ordered
  word points to that shared entry. Repeated words retain separate positions,
  source translations, and grammar in their verse.
- Return the best seven available cached co-occurrences, ordered by score
  descending then word ID. Fewer than seven is valid when fewer exist.
- Existing co-occurrences and occurrence searches group by base Strong's across
  inflections. Label this scope explicitly; it does not resolve homographs.
- Full hydration applies to requested verses. Occurrence lists contain compact
  references and counts, without recursively hydrating the entire corpus.

## Response contract

Top-level fields:

| Field | Contents |
| --- | --- |
| `schema_version` | `1` |
| `status` | `ok`, `invalid_request`, `passage_not_found`, or `packet_limit_exceeded` |
| `verses` | Requested verses with ordered tokens, dating, map data, semantic evidence, and component coverage |
| `lexical_entries` | Shared entries keyed by base Strong's, referenced by every word |
| `sources` | Referenced dataset/release/license/attribution records |
| `coverage` | Corpus scope, requested/returned counts, occurrence mode, completeness, limits, and unavailable fields |

Each verse contains its canonical reference, corpus verse ID, language/direction
when supported, ordered `words`, the existing `chronology` packet, the existing
`geography` packet, and relevant reviewed `semantic_evidence`.

Each word contains:

- `word_position`, `word_id`, `original_word`, `transliteration`, `strongs_nr`,
  and `lexical_entry_key`.
- `grammar`: raw code, declared scheme if known, decoded features supported by a
  verified mapping, and unresolved tags. Never infer a grammatical analysis from
  an English gloss.
- `translations`: source occurrence rendering, source locator, available
  renderings, and corpus gloss. The public AI packet uses public source text;
  private reader overrides are not exported through the public MCP.
- Available source definitions, with provenance and nulls for missing material.
- Available disambiguated lexeme candidates, keeping homograph alternatives
  separate. A shared base Strong's identifier does not establish a token sense.

Each shared lexical entry contains:

- `identity_scope: "base_strongs"`, `strongs_nr`, and explicit ambiguity status.
- `occurrences`: counting method, corpus token total, distinct-passage total,
  returned references with counts, returned-reference count, and `complete`.
- `top_connected_words`: up to seven words with rank, ID, Strong's, original
  form, transliteration, available translations/definitions, cached score,
  frequency, average distance, and statistical-method/coverage notes. Label
  missing cache entries; these scores do not establish synonymy.
- Available semantic candidates and reviewed evidence links with their
  epistemic categories, citations, limitations, and counterexamples. An empty
  curated result means unavailable annotation, not absence of a relationship.

Chronology preserves model assumptions, historical setting versus composition,
alternatives, unknown dates, provenance, and evidence cursors. Geography preserves
coordinates/bounds, ancient and modern names, setting versus composition/audience
locations, chronological context, era gazetteer, disputed alternatives, and
symbolic/non-physical status. Map data is structured JSON, rather than a rendered
map image. Existing nested component limits remain visible in coverage metadata;
one response never claims completeness for an incomplete evidence page.

## Completeness, performance, and access

- Implement hydration and deduplication inside PostgreSQL with explicit ordering,
  materialized distinct lexical targets, indexed form lookup, a single corpus
  token sweep for all requested occurrence groups, and reuse of translation
  options, chronology, and geography functions. Legacy searches retain GIN usage.
- Assess query plans and anonymous PostgREST runtime before choosing additional
  indexes or cached occurrence summaries. Do not add full corpus scans per token.
- Target the existing MCP database timeout of 12 seconds. Set an explicit
  maximum JSON payload of 8 MiB. If an all-occurrences result cannot fit, return
  `packet_limit_exceeded` with requested references, measured size/limit, and a
  suggested smaller request or explicit sample mode. Do not silently truncate.
  Measure common function-word and long-verse cases before finalizing this limit.
- Use `SECURITY INVOKER`, an empty search path with qualified names, explicit
  execution grants, and existing read-only RLS. No new writable corpus tables.
- Public MCP responses must contain no private translation choices or owner IDs.
- Surface real component errors or explicit unavailable statuses; do not replace
  missing live results with sample data in an AI packet.

## New pattern-finding prompts

Expose these ten templates through native MCP prompts, `get_research_prompt`,
and the UI. Each starts by fetching hydrated verse packets for explicit passages.
Search tools locate additional candidates, which must be inspected before use.

| Prompt | Research instruction |
| --- | --- |
| `find_repetition` | Trace repeated lexemes, inflection changes, clusters, and inclusions. Distinguish exact repetition from shared base Strong's or translation overlap. |
| `find_literary_structure` | Test parallelism, inclusio, and proposed chiasm against ordered text, boundaries, and competing segmentations; report weak or missing correspondences. |
| `trace_motifs` | Compare narrative settings, actions, participants, and outcomes across passages; include passages where the proposed motif fails. |
| `test_intertextuality` | Assess proposed quotations/allusions with lexical overlap, order, distinctive combinations, context, and chronology; separate explicit identification from possible allusion. |
| `compare_semantic_contrasts` | Examine contrasts and semantic fields through attested glosses, grammar, contextual usage, and reviewed annotations; distinguish candidates from assigned senses. |
| `trace_grammatical_shifts` | Investigate person, number, gender, tense/aspect, voice, and clause-role changes only where the supplied morphology supports them. |
| `find_rare_connections` | Explore uncommon word combinations and ranked associations with denominators and representative verse checks; flag common-word effects and selection bias. |
| `trace_patterns_in_time_and_place` | Compare motifs and word use by supported historical settings and locations; preserve dating alternatives, unknowns, and setting/composition distinctions. |
| `compare_translation_effects` | Show how source renderings and lexical alternatives affect a proposed pattern; preserve original tokens and avoid assuming English repetition reflects original repetition. |
| `challenge_pattern` | Actively seek counterexamples, alternative explanations, disputed identifications, and missing evidence for a supplied pattern claim. |

Every template requests an answer with `observations`, `candidate_patterns`,
`evidence`, `counterexamples`, `alternative_explanations`, `uncertainty`,
`coverage`, and `next_checks`. Each pattern needs verse/word-position citations,
an epistemic category, and a qualitative confidence explanation. No fabricated
significance tests, unsupported probabilities, numerology presented as evidence,
or claim that a prompt itself constitutes a proven discovery algorithm.

## Acceptance and rollout

1. Verify Genesis 1:1 and John 1:1 token/translation/grammar parity; repeated
   tokens; a Psalm heading; invalid and nonexistent references; and mixed batches.
2. Compare complete occurrence totals/references to existing SQL searches for
   rare and common words. Verify shared-entry deduplication and sample flags.
3. Verify deterministic top-seven ranking against the cached co-occurrence RPC;
   handle zero partners, unknown definitions, and ambiguous base Strong's.
4. Verify chronology alternatives, map provenance, symbolic Revelation 21:2,
   absent semantic annotations, and reviewed evidence plus counterexamples.
5. Verify anonymous read grants, denied corpus writes, private-choice exclusion,
   large-packet behavior, query plans, and MCP timeout behavior.
6. Add OpenAPI schemas and public MCP contracts; verify all ten templates are
   retrievable, use hydration, and preserve controls and uncertainty.
7. Expose a Hydrated Verse tab and pattern-template selector with JSON copy and
   prompt-plus-data copy, supporting the active verse and additional references.
   Verify passage changes, keyboard use, errors, and stale-request protection.
8. Run type, size/TOC, production build, targeted live RPC tests, OpenAPI/MCP
   regressions, and browser verification; synchronize the registry and API docs.

Context7 tools were unavailable on both discovery attempts. Current official
Supabase database-function/RPC/optimization documentation and MCP SDK sources
were used as the fallback; the pinned STEP headers identify grammar schemes.

## Shipped coverage and verification

The RPC preserves raw grammatical tags and source schemes; decoded_features is
currently empty and unresolved_tags retains the original tag. No human-readable
expansions, token senses, or semantic domains are fabricated. The semantic graph
remains limited to its reviewed source coverage. Dating and geographical packets
preserve their own error statuses, limits and uncertainty.

Verified live source parity (Hebrew, Greek, Psalm heading), full occurrence
reference/count parity, top-seven cache ordering, homograph alternatives,
symbolic geography, reviewed evidence, anonymous privileges, and input errors.
Browser checks cover one-call batches, full JSON/prompt copy, download, samples,
offline errors, stale responses, keyboard use and mobile rendering. JSON Schema
2020-12 validation uses an exported full live packet. Existing reader and MCP
regressions are recorded in TASKS.md.

An initial mixed long-verse stress test exceeded 12 seconds. The additive batch
optimization now completes that same test under the 12-second SQL budget,
returning an 8,178,791-byte JSON packet without truncation. Large results can
still exceed a particular AI client's context window; use explicit samples or
fewer requested passages when needed.

Public HTTP verification also exercises a five-long-verse packet of 8,412,278
bytes: it returns `packet_limit_exceeded` without partial verses in about 10.8
seconds. Function-scoped budgets are 10s for hydration and 8s for the existing
relationship endpoint; role/global settings are unchanged. This also resolves
the previously recorded relationship RPC timeout in the public OpenAPI suite.
