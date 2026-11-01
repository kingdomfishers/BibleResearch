# Bible relationship research architecture

Design date: 2026-11-01. Status: proposed; no database changes made.
Execution queue: [TASKS.md](TASKS.md). Current runtime: [ARCHITECTURE.md](ARCHITECTURE.md).

## 1. Decision

Use **lexemes and occurrence tokens as the foundation, STEP lexical relationships
and MACULA linguistic annotations as enrichment, and a passage/concept/event graph
for research across the Bible**. These are complementary layers. A related-word
list or syntax tree alone cannot establish the motifs in the requested examples.

Expose one bounded research RPC/MCP tool accepting a word, passage or concept and
returning candidate meanings, relationships, statistics and cited evidence paths.
The first lookup should be useful without prerequisite ID-resolution calls;
exhaustive research still requires pagination and explicit coverage information.

Keep Vite, vanilla TypeScript, Supabase PostgreSQL and the thin MCP adapter. All
joins, intersections, distance calculations, aggregation and traversal stay in SQL.
PostgreSQL adjacency tables suffice; no separate graph database is needed initially.

## 2. Current baseline

The import manifest records 150,105 form/morphology records, 443,524 ordered tokens,
13,913 base Strong's identifiers and 31,203 passages including 116 Psalm headings.
These are recorded import values, not a fresh live database audit.

Currently `words` describes forms; occurrences exist in `verses.word_ids` arrays.
The parser selects one root, removes Hebrew segmentation slashes for display and
reduces identifiers such as `H0430G` to `H430` for database storage. Occurrence
glosses become aggregated form renderings. The local audit preserves some extra
information, but full recovery requires reparsing pinned raw TSV source records.

Co-occurrences group inflections by base Strong's, count within-verse token pairs
and retain only 15 partners. This merges some lexical distinctions. The existing
`relationship_score` measures verse density, not semantic similarity or doctrine.

## 3. Sources and limits

| Source | Contribution | Boundary |
| --- | --- | --- |
| STEP TAHOT/TAGNT | Primary OT and selected NA28-membership NT occurrences | Preserve the user's edition choice and STEP reference/reading conventions |
| STEP TBESH/TBESG | Lemmas, transliterations, licensed glosses and e/d/uStrong mappings | Base numbers, disambiguated entries and unified groups are different identities |
| STEP Related words | Lexical expansion from a verified reproducible source | Establish the UI's backing dataset and semantics before claiming full equivalence |
| MACULA Hebrew | Syntax, morphology, senses/domains, roles and references | Align WLC-based annotations to STEP's edited primary readings |
| MACULA Greek | Linguistic annotations on supported texts | Repository lists Nestle1904 and SBLGNT; neither is a drop-in NA28 layer |
| Reviewed concept/event annotations | Narrative patterns and intertextual hypotheses | Each assertion needs citations, source, scope and review status |

STEP's guide describes Related words as sharing semantic features. This review
did not establish a complete downloadable export matching the UI. Start with
published identifier mappings and explicitly documented relations; preserve
unknown types as `related_unspecified`, never automatically as synonyms.
The current STEP README lists TBCWG concept groups as forthcoming and describes
AI authorship. It is not a dependency; preserve authorship/review state if used later.
[STEP guide](https://stepbibleguide.blogspot.com/p/tools.html),
[data catalog](https://github.com/STEPBible/STEPBible-Data).

MACULA tree formats preserve structure omitted by flat TSV. Import attributes
actually present in the pinned release and publish coverage by book/type rather
than assuming every advertised annotation is complete.
[Hebrew repository](https://github.com/Clear-Bible/macula-hebrew),
[Greek repository](https://github.com/Clear-Bible/macula-greek).

Pin commits, file paths and SHA-256 digests. Track rights, attribution, exclusions
and transforms per component/column. Keep TBESH's restricted Online Bible `Meaning`
column excluded. MACULA licenses describe CC BY collections with named upstream
components and permission notices: audit selected fields individually. A MARBLE,
SDBH or Louw-Nida identifier does not authorize downloading an external dictionary's
full definitions. An uncleared component can be deferred without blocking core work.
[Hebrew notices](https://github.com/Clear-Bible/macula-hebrew/blob/main/LICENSE.md),
[Greek notices](https://github.com/Clear-Bible/macula-greek/blob/main/LICENSE.md).

## 4. Lexemes, text and occurrence identity

The following are logical table contracts, not executable DDL. Internal keys use
`bigint` identity; expose IDs as JSON strings to avoid JavaScript precision loss.
External identifiers, morphology and sense codes are always `text`.

| Tables | Required fields/invariants |
| --- | --- |
| `source_releases`, `source_records` | Dataset, commit/file/hash, license, attribution, transformation version, immutable raw record and source locator |
| `text_versions`, `reference_systems` | Language, edition/membership, reading policy, source release and versification; do not label STEP's shared spelling an exact printed NA28 transcription |
| `passages`, `passage_mappings` | Version-local reference and canonical display reference; sourced many-to-many verse mappings, including verse 0 |
| `lexemes` | Language (`hbo`, `arc`, `grc`), original/search lemma, source transliteration, POS and source entry identity; separate homographs |
| `lexeme_identifiers`, `lexeme_groups`, `lexeme_group_members` | Namespaced raw IDs, derived aliases and release-scoped many-to-many mappings; uStrong grouping does not force identity merges |
| `lexeme_descriptions` | Licensed gloss/definition, language, source record/field and authorship; separate source text from editorial/AI explanation |
| `tokens` | Version/passage/position, original_source, display_form, search_form, source transliteration, morphology_code/scheme, occurrence gloss, source record/position and spacing/punctuation metadata |
| `token_components`, `component_lexemes` | Ordered affix/morph parts with raw form/tag/morphology; distinguish decomposition from alternative analyses and mark the content lexeme when supported |
| `senses`, `token_senses` | Namespaced sense IDs tied to lexemes; optional token/component links with method, evidence and review state; allow candidate alternatives |
| `semantic_domains`, `sense_domains` | Namespaced domain hierarchy and multiple domain memberships; explicit mappings between schemes |

Enforce token uniqueness by version/passage/positive position and component order
within a token. Composite FKs enforce passage/version and sense/lexeme consistency.
Repeated words are separate occurrences. Store every identifier atom as well as
the original compound tag field. Preserve base, extended, disambiguated and unified
namespaces, case, suffixes and leading zeros; normalization adds lookup aliases.
Several lexical parts must not silently collapse to the first matched Strong's tag.

`original_source` preserves the exact selected source field, including pointing,
accents, punctuation and separators. `display_form` can remove documented internal
markers but cannot overwrite raw text. Keep source records and reading variants;
do not claim byte-exact continuous manuscript text reconstructed from token fields.
Transliteration is source-supplied with a scheme/source label; unknown remains null.

Derive search forms using versioned language-specific Unicode rules. Document
accent/pointing and punctuation handling, Hebrew shin/sin distinctions, Greek sigma
and iota-subscript behavior. Search normalization must not merge lexical identities.
Token-to-sense assignment is optional; ambiguity is data, not an import failure.

## 5. MACULA alignment and linguistic context

Import each selected MACULA base text as a separate text version with its own
tokens/components. `alignment_sets` and `token_alignments` preserve grouped
one-to-many/many-to-one mappings, method, review state and explicit unmapped units.
Use verified versification maps, ordered forms, lemma and local sequence context.
Neither Strong's alone nor an ordinal alone proves identity across sources.

Keep `syntax_nodes`, `syntax_edges` and ordered `syntax_node_members`, supporting
cross-verse and discontinuous spans. Preserve original dependency/constituency
schemes, roles and participant references on their source version first. Project
an annotation onto primary tokens only when its particular alignment supports it.
A split/merge may support a lexical tag without supporting a whole syntax edge.

Test Qere/Ketiv, restorations, affixes, punctuation, omitted/added/reordered Greek
words and verse-number differences. Never mix SBLGNT additions into the primary
NA28-membership text by positional matching. Every projected evidence item reports
annotation edition and alignment quality; uncertain projections remain candidates.

## 6. Concepts, entities, events and evidence graph

`concepts` represents research topics such as WELL, MARRIAGE, LAMPSTAND, LAMP,
SPIRIT and SEVEN_SPIRITS_OF_GOD; `concept_aliases` supplies multilingual lookup.
A phrase concept differs from the word SEVEN or every use of SPIRIT. Aliases and
gloss matches generate candidates, not proven concept occurrences.

`mentions` anchors concepts/entities to ordered token spans or passage ranges.
`entities` distinguishes people, places and objects from dictionary words.
`events` and `event_roles` describe participants, actions, locations and outcomes
over narrative units. Source role labels retain their scheme; a frame is not
automatically a marriage event. Every mention/event has evidence, method and review
state. Reviewed seed annotations deliver the first motifs; offline rules or AI can
propose additional candidates for review.

Use an evidence graph in relational tables:

- `research_nodes`: typed registry of lexemes, senses, tokens, concepts, entities,
  events, syntax nodes and passage ranges. Each node has exactly one valid backing
  FK and a uniqueness constraint; no unchecked `(kind, id)` references.
- `relation_types`: allowed endpoint kinds, direction, inverse and symmetry;
  database validation enforces endpoint and inverse rules.
- `assertions`: subject/predicate/object, source record/release, method, epistemic
  category, review state, scope/version and optional source confidence. Preserve
  competing assertions and rejected/superseded history.
- `assertion_evidence`: ordered spans/passages, source locators, explanations and
  supporting/counterevidence. A path may need several separate passages.
- `passage_links`: sourced quotations, cross-references, proposed allusions and
  thematic parallels, represented as assertions for traversal.

| Category | Example predicates | Meaning |
| --- | --- | --- |
| Lexical | `variant_of`, `derived_from`, `synonym_of`, `antonym_of`, `related_unspecified` | Sourced word-level relationship; derivation does not imply identical meaning |
| Linguistic | `subject_of`, `object_of`, `modifies`, `refers_to` | Occurrence/context annotation with source scheme and alignment |
| Statistical | `cooccurs_in_verse`, `cooccurs_in_unit`, `near_in_tokens` | Corpus measurement with an explicit counting method |
| Textual | `identified_as_in_passage`, `quotes`, `cross_reference` | Scoped textual assertion or sourced reference; editorial links stay editorial |
| Interpretive | `narrative_parallel`, `thematic_association`, `possible_allusion`, `typological_reading` | Attributed interpretation/hypothesis with evidence and limitations |

Review state (`candidate`, `reviewed`, `rejected`) is independent of category.
A reviewed interpretation does not become a textual identity. Sharing a number or
English gloss cannot create equivalence. Pair statistics use dedicated tables,
not millions of duplicate graph assertions.

## 7. Statistics and discovery

Create `analysis_runs`, `context_units`, `context_unit_members`, `lexeme_pair_stats`
and `concept_pair_stats`. Pin corpus, unit definition, normalization, extractor and
scorer versions. Contexts include verse, available clause/sentence, fixed adjacent
verse windows and sourced/curated narrative units. Generated windows are labelled
separately from editorial pericopes and never cross book boundaries.

Store token-pair count, distinct passage/unit count, marginal unit frequencies,
corpus denominator and mean/minimum token distance where meaningful. Deduplicate
identical spans and overlapping windows before counting independent episodes.
Do not count parallel editions as independent occurrences of a biblical episode.
Return book distribution and stopword/POS filter metadata.

Specify a fixed, versioned association measure such as smoothed NPMI or
log-likelihood with minimum support and rare-pair controls; validate hand-counted
fixtures. Keep the old frequency/distance score for legacy compatibility only.
Report raw counts beside scores. Sparse motifs are not statistical proof.

Rank paths using category, review/source quality, alignment quality, support and
length, with deterministic tie-breaking. Keep curated motifs and measured
associations separate. Never describe a combined rank as theological confidence or
a probability. Evaluate discovery on held-out motifs as well as reviewed examples.

## 8. One-lookup RPC and MCP contract

Add `research_relationships_v1(p_request jsonb) returns jsonb` and MCP tool
`research_relationships`. PostgreSQL validates the versioned request and performs
the work. Edge forwards one allowlisted RPC with no model calls or corpus joins;
the UI calls only `BibleRPC`.

Illustrative requests, not deployed APIs:

```json
{"subject":{"text":"well"},"target":{"text":"marriage"},"mode":"explain","corpus":"primary","limits":{"paths":10,"evidence_per_path":3,"max_hops":3}}
```

```json
{"subject":{"text":"menorah"},"target":{"text":"seven spirits of God"},"mode":"explain","corpus":"primary"}
```

Also accept `mode: discover` without a target, typed lexeme/token/concept IDs,
passage references and language/book/category/context filters. Resolve text against
aliases, lemmas, identifier aliases and licensed glosses. This is a structured
lookup, not an unrestricted natural-language question interpreter. Ambiguity returns
candidates and `needs_disambiguation`, or separate bounded branches. Base Strong's
returns all mapped lexemes; base-level aggregation must be explicitly requested.

Response contract:

- Schema/corpus/analysis versions and request resolution with candidate IDs,
  labels, original forms, morphology, identifiers and optional senses.
- Separate lexical, linguistic and statistical results and `evidence_paths` with
  ordered typed edges, category, method, review state and stable IDs.
- Each path includes citation references, token spans, original text, available
  source glosses, source edition, alignment and attribution. Glosses are not
  presented as a continuous English translation.
- Counterevidence, competing readings and limitations; hypotheses are labelled.
- Coverage by annotation type, unmapped units and actual searchable scope; an
  empty result means no evidence in that scope, not proof of no relationship.
- Separate token/passage/unit/episode counts; exact totals when computed,
  otherwise explicitly unknown or lower bounds.
- Deterministic keyset pagination, per-section truncation and missing-evidence
  flags. Cursors bind request and immutable analysis run; reject incompatible ones.

Defaults: 10 resolved candidates, 20 paths, 3 evidence items/path, 3 hops and
50 KiB serialized output. Enforce query fan-out/cycle/time limits and byte limits
in the database and adapter. Trim deterministically with visible truncation and a
cursor for every truncated section. Retain old runs for cursor continuity.
A companion evidence-detail RPC resolves stable IDs, but the first packet must
already explain a relationship. Never present a bounded traversal as exhaustive.

## 9. Required acceptance examples

**Well and marriage:** reviewed episode annotations for Genesis 24, Genesis 29
and Exodus 2:15-21 must return three independent narrative associations, citing
both the water encounter and later marriage. Retrieval cannot depend on same-verse
co-occurrence. Include non-marriage well contexts such as Genesis 21/26 and the
examined denominator. This motif is not the lexical definition of WELL.

**Menorah and seven spirits:** evaluate a chain through Exodus 25:31-40, Zechariah
4:2, 4:6, 4:10, Revelation 4:5 and 5:6. Keep LAMPSTAND distinct from LAMP/TORCH.
Revelation 4:5 explicitly identifies seven fiery lamps with the seven spirits;
connecting this imagery to Zechariah's lampstand is an intertextual interpretation.
Revelation 5:6 contributes seven eyes/spirits imagery. Revelation 1:20 identifies
its seven lampstands with churches: return that contextual distinction rather than
a global LAMPSTAND = SPIRIT edge. Sharing SEVEN alone is insufficient. These are
benchmark annotations, not claims that STEP/MACULA provides theological assertions.
[Revelation 4:5](https://www.stepbible.org/?q=version=ESV%7Creference=Rev.4.5),
[Zechariah 4:2](https://www.stepbible.org/?q=version=ESV%7Creference=Zech.4.2),
[Revelation 1:20](https://www.stepbible.org/?q=version=ESV%7Creference=Rev.1.20).

Other controls: preserve H1254 lexical subdivisions, Hebrew/Aramaic labels, repeated
token positions and null senses. Ambiguous English words return candidates;
matching H/G numeric portions never establishes a cross-language relationship.

## 10. Access, performance and publication

Index token passage/order, identifier namespace/value, normalized lemmas/aliases,
both adjacency directions, evidence lookups, alignments and frequently joined FKs.
Add full-text/trigram search only where measured workloads justify it. Precompute
pair statistics/frequent neighborhoods; use bounded indexed recursive traversal.

Approved corpus tables have SELECT-only RLS and explicit grants. Staging,
restricted fields and drafts stay unexposed with no public privileges. RPCs use
SECURITY INVOKER and fully qualified names; revoke default PUBLIC execute and
grant only intended functions. Caller roles need SELECT/USAGE on approved function
dependencies; do not fix access failures by granting owner privileges.
Compatibility views use `security_invoker` on supported PostgreSQL versions.
Materialized views do not inherit base-table RLS; prefer approved cache tables
with their own RLS/grants. Verify anonymous access cannot see drafts/restricted data.
[Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[database functions](https://supabase.com/docs/guides/database/functions).

Publish a new immutable analysis run by atomically switching an active-run pointer
after validation. Targets to benchmark, not promises: warm RPC p95 <= 1 s, cold
p95 <= 3 s, zero responses above the byte cap. Record concurrency, plans/buffers,
storage and refresh cost on the full corpus.

## 11. Migration and delivery

1. Pin sources, settle identity/rights/contracts and define evaluation fixtures.
2. Add tables alongside populated legacy tables; reparse raw STEP into staging.
3. Prove primary count/order parity and raw-field fidelity before changing readers.
4. Publish lexical relationships/statistics; pilot then expand MACULA alignment.
5. Add reviewed concepts/events, general discovery and bounded evidence retrieval.
6. Expose through SQL/MCP/UI, shadow-compare reads, rehearse rollback and cut over.

Never run the current empty-database importer against populated production tables.
Preserve legacy IDs via explicit mappings: numeric form IDs are not new token or
lexeme IDs. Keep the four prompt signatures and documented base-Strong's behavior
in v1; precise identities/senses use versioned APIs. Preserve legacy tables during
rollout. Rollback switches readers and published version/run pointers. Retirement
requires a separate decision after a compatibility window.

Embeddings can later retrieve candidates with pinned model/index versions; their
similarity never becomes an evidence edge. A separately sourced LXX alignment can
add explicit translation evidence. Neither is required for the initial motif lookup.
