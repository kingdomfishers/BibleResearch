# BibleResearch — Persistent Research Knowledge Graph

Status: Architecture & Implementation Specification (2026-11-26).

This document defines the architecture, PostgreSQL/Supabase data model, security boundaries, 7-tool MCP integration, website UI parity, and evaluation plan for BibleResearch's persistent, traversable Research Knowledge Graph (`RG`). It builds directly on [DLM_RESEARCHER_METHODOLOGY.md](DLM_RESEARCHER_METHODOLOGY.md), [ARCHITECTURE.md](ARCHITECTURE.md), and [DATA_MODEL.md](DATA_MODEL.md).

---

## 1. Mission & Three-Layer Architectural Invariants

The goal is cumulative, trustworthy, cross-session discovery of biblical connections, underlying relational principles, and cross-domain patterns across Scripture, original languages, physical reality, and historical/literary structures—without ever contaminating Scripture or BibleResearch's deterministic discovery engine.

### Strict Three-Layer Separation

| Layer | Owner / Storage | Mutability | Examples |
| --- | --- | --- | --- |
| **1. SOURCE DATA** | Cloudflare Static Corpus + retained Supabase canonical tables | Immutable / release-pinned | STEP TAHOT/TAGNT/TBESH/TBESG, `verses`, `words`, `lemmas`, `lexical_senses`, `lexical_roots`, `lemma_root_links`, `canonical_entities`, `places`, `chronology_events`, Swete/Rahlfs LXX, CrossReferences.org |
| **2. ALGORITHMIC DISCOVERY** | Cloudflare Worker (`bibleresearch-corpus`) + V3/R13 engines (`src/relationships/`) + legacy curated tables (`research_nodes`, `assertions`, `assertion_evidence`, `entity_relationships`, `concepts`, `concept_properties`) | Deterministic / offline-built / read-only at runtime | `E_perp` scoring, PPR conductance graph, R8/R13 syntax frames, wordplay/chiasm detectors, `discover_subgraph_v1`, `research_relationships_v1` |
| **3. RESEARCH KNOWLEDGE** | Supabase PostgreSQL (`rg_*` knowledge graph tables + existing `notes*` tables) | Mutable, versioned, reviewed overlay | AI and human observations, concept dossiers, physical/external mechanisms, n-ary process/pattern mappings, DLM hypotheses, challenges, counterexamples, open questions, research trails |

### Non-Negotiable Invariants

1. **Zero Contamination:** Research Knowledge may *reference* Layer 1 and Layer 2 identifiers (`verse_id`, `word_id`, `lemma_id`, `sense_id`, `canonical_entity_id`, `algorithm_evidence_id`), but must **never** automatically modify them, write to `entity_relationships` / `concepts` / `concept_properties` / `research_nodes` / `assertions`, or alter algorithmic ranking/scoring.
2. **Algorithmic Independence:** Disabling or emptying the Research Knowledge Graph—or adding 1,000+ adversarial AI claims—must leave all source-only and algorithm-only discovery outputs byte-identical.
3. **Full Provenance Preservation:** Every claim and node preserves separate fields for `origin_layer` (`human_research`, `ai_research`, `external_empirical_citation`), `author_id` / `author_kind` (`human` | `ai`), `ai_provider` / `ai_model` / `ai_client`, `evidence_class`, `epistemic_state`, `review_status` (`unreviewed` | `confirmed` | `disputed` | `rejected` | `superseded`), and multidimensional `confidence`. Human confirmation never erases AI authorship.
4. **DLM Layer Integrity:** Per [DLM_RESEARCHER_METHODOLOGY.md](DLM_RESEARCHER_METHODOLOGY.md) §1, DLM layer designations remain revisable interpretive hypotheses. Schema fields preserve descriptive layer names alongside optional `0–7` index compatibility without silently remapping indexes or asserting an eighth layer.
5. **Untrusted Content Contract:** All stored research nodes, claims, notes, and trails are untrusted data, never executable instructions or canonical Scripture.

---

## 2. Infrastructure Audit: Reuse vs. Extend vs. Separate

### Existing Tables Audited

| Existing Infrastructure | Current Role & Live State | Decision | Rationale |
| --- | --- | --- | --- |
| `research_nodes` (18), `assertions` (7), `assertion_evidence` (13), `entity_relationships` (15,642), `concepts` (1,349), `concept_aliases` (33), `concept_properties` (8,864) | Used by **Layer 2** deterministic/benchmark RPCs (`lookup_entity_relationships_v1`, `lookup_concept_properties_v1`, `build-r10-discovery-index.mjs`, `build-relationship-slice.mjs`) | **KEEP SEPARATE (Read-Only)** | Mutating these from AI/human research would contaminate benchmarked source/algorithmic layers and Cloudflare export parity. |
| `notes` (7 published, 206 removed), `note_anchors` (329), `note_revisions` (486), `note_blocks` (3), `note_authors` (5), `note_settings` (1), `note_kinds` (7), `note_block_types` (9) | Active single-user note system + `source_context.dlm_v1` cards | **REUSE & LINK** | Preserve 100% of existing notes, revisions, authors, kill switches, and rate limits. `rg_claims.source_note_id` and `rg_nodes.note_id` optionally bridge existing notes into the graph without destructive migration or fabricated provenance. |
| `note_connections` (52) | Intra-note edges (`from_anchor_id` and `to_anchor_id` must belong to the same `note_id`) | **PRESERVE AS-IS + BRIDGE** | Keep existing intra-note semantics intact for `NoteEditor.ts` / `get_note_v1`. Expose them in neighborhood expansion alongside global `rg_claims` edges, while new global cross-session edges live in `rg_claims` + `rg_claim_links`. |
| `note_connection_types` (16) | Controlled edge vocabulary used by UI and `agent_save_note_v1` | **EXTEND ADDITIVELY** | Add semantic columns (`inverse_type_key`, `is_transitive`, `implies_equivalence`, `usage_tier`, `discouraged`) and add the rich KG predicates (`contains`, `part_of`, `has_property`, `performs_function`, `requires`, `enables`, `produces`, `transforms_into`, `precedes`, `transmits`, `symbolizes_explicitly`, `formally_resembles`, `shares_root`, `analogous_to`, `hypothesized_to_express`, `supports`, `challenges`, `depends_on`, `supersedes`, etc.) so UI and MCP share one authoritative predicate registry. |
| `mcp_connection_chains` (57) | Ephemeral TTL-expiring MCP traversal session state | **REUSE AS EPHEMERAL SESSION** | Keep `chain-store.ts` for short-lived `follow_connectionchain` sessions; add persistent `rg_research_trails` for durable cross-session investigations and optionally link via `linked_chain_id`. |

---

## 3. Knowledge Graph Data Model

### 3.1 Entities (`public.rg_nodes`)

Every entity in the graph has a stable UUID (`id`) and unique deterministic/human-readable `node_key` (e.g., `canon:lemma:H2233`, `canon:verse:23:55:10`, `canon:word:60412`, `rg:concept:transmissible_generative_capacity`, `rg:ext:seed_physiology_umn`).

- **Supported `node_kind` taxonomy:**
  - Canonical references (reusing canonical IDs without duplicating corpus text): `passage`, `word_occurrence`, `word_form`, `lemma`, `sense`, `root`, `letter_or_formation`, `person`, `place`, `event`, `canonical_concept`
  - Research-layer entities: `concept`, `physical_object`, `component`, `property`, `process`, `mechanism`, `principle`, `mathematical_structure`, `literary_structure`, `pattern`, `discovery`, `definition`, `hypothesis`, `question`, `external_source`, `note_ref`
- **Disambiguation & Senses:** `aliases text[]`, `original_script`, `transliteration`, `strongs_code`, `definitions jsonb` (layered definitions: `lexical_sense`, `biblical_use`, `physical_mechanism`, `abstract_principle`, `theological_hypothesis`), `polarity_notes` (e.g., good vs. evil seed/tree/leaven), and `disambiguation_note` ensure similar English labels (or homographs like `H7799` lily vs. `H7800` Susa) are never silently conflated.

### 3.2 Controlled Relationship Vocabulary (`public.note_connection_types`)

All directional relationships reference `note_connection_types(type_key)`. Each type explicitly declares:
- `label` & `inverse_label` + `inverse_type_key`
- `default_direction` (`directed` | `bidirectional` | `undirected`)
- `is_symmetric` (e.g., `parallels`, `contrasts_with`, `shares_root`, `unresolved_with`)
- `is_transitive` (**true ONLY** for strict structural/order relations: `contains`, `part_of`, `precedes`; **false** for `analogous_to`, `alludes_to`, `formally_resembles`, `wordplay`, `hypothesized_to_express`, `challenges`, etc., preventing false multi-hop endpoint equivalence)
- `implies_equivalence` (`false` across biblical/cross-domain edges)
- `discouraged` (`true` for `related` and `other`, nudging researchers toward precise predicates)

### 3.3 Atomic Claims, Ordered Participants & Evidence (`rg_claims`, `rg_claim_participants`, `rg_claim_evidence`, `rg_claim_links`, `rg_claim_revisions`)

Adapting the nanopublication model (`assertion` + `provenance` + `publication/revision`):

1. **`rg_claims`:** Independently addressable atomic propositions (`claim_key`, `claim_kind`: `textual_observation` | `linguistic_finding` | `explicit_symbol` | `literary_pattern` | `physical_mechanism` | `relational_analogy` | `process_mapping` | `abstract_principle` | `dlm_hypothesis` | `challenge_critique` | `definition` | `unresolved_question`).
   - Binary core (`subject_node_id`, `predicate`, `object_node_id`, `direction`) for fast indexed graph traversal.
   - Precise `assertion_text`, `contextual_scope`, `explanation_md`, `limitations`, `unresolved_questions[]`, `dlm_metadata jsonb` (named layers + optional `0–7` indexes + `form_flow`).
   - Epistemic separation: `evidence_class` (`TEXT_EXPLICIT`, `TEXT_LINGUISTIC`, `TEXT_INTERTEXTUAL`, `TEXT_PATTERN`, `SCIENCE_EMPIRICAL`, `DLM_HYPOTHESIS`, `DISPUTED`, `OPEN`), `epistemic_state` (`established_observation`, `well_supported_interpretation`, `plausible_hypothesis`, `speculative`, `disputed`, `open`, `rejected`, `superseded`), `review_status`, `confidence`, and `confidence_dimensions` (`source_reliability`, `identity_precision`, `textual_explicitness`, `empirical_support`, `independence`, `coverage`).
   - Staleness tracking: `is_potentially_stale`, `stale_reason`, `stale_since`, `supersedes_claim_id`.
2. **`rg_claim_participants`:** Ordered n-ary slots (`role`, `ordinal`, `slot_key`, `notes`) for processes, transformations, chiasms, and Gentner structure-mappings (`agent`, `patient`, `instrument`, `source`, `destination`, `condition`, `outcome`, `slot_a`, `slot_b`, etc.) so multi-participant relationships are never flattened into misleading binary pairs.
3. **`rg_claim_evidence`:** Typed `supporting` and `counterexample` / `control` / `limiting_case` rows. Each row records a normalized `source_key` (e.g., `verse:23:55:10`, `word:60412`, `url:https://...`, `claim:<uuid>`) and `is_primary_source`, enabling automated **echo-chamber / shared-upstream detection** (`independent_primary_witness_count`). External empirical claims require HTTPS `external_url` + `external_title` and **never** require fabricated biblical anchors.
4. **`rg_claim_links`:** Typed claim-to-claim edges (`supports`, `challenges`, `depends_on`, `supersedes`, `refines`, `contradicts`, `explains`). Triggers/RPC validation reject cyclic `depends_on` / `supersedes` graphs and automatically flag downstream `depends_on` / `supports` dependents as `is_potentially_stale = true` whenever an upstream claim is updated, disputed, rejected, or superseded.
5. **`rg_claim_revisions`:** Immutable append-only revision history preserving `editor_author_id`, `editor_kind`, `action`, and full JSON snapshot.
6. **`rg_research_trails`:** Durable cross-session investigation checkpoints (`research_question`, `scope_metadata`, `status`: `active` | `paused` | `completed` | `archived`, `frontier` leads, `checkpoints`, optional `linked_chain_id`).

---

## 4. Traversal, Anti-Echo-Chamber & Ranking Rules

- **Layer Modes:** Queries support `source_only`, `algorithm_only`, `research_only`, and `combined` (merging corpus paths with RG paths while labeling every edge's `origin_layer`, `evidence_class`, `direction`, and `transitivity_valid`).
- **Bounded & Cycle-Aware:** Neighborhood expansion enforces `limit <= 25` and exposes degree counts for hub control; path search (`rg_find_paths_v1`) uses bounded BFS/recursive CTE (`1..4` hops, frontier hub cap `25`, visited-node cycle prevention) and explicitly classifies every path as `validated_inference_path` (all hops transitive/textual-linguistic & reviewed/high-evidence) vs. `exploratory_path` (with per-hop `transitivity_warning`).
- **Recursive Evidence Trace (`rg_trace_evidence_v1`):** Walks upstream `depends_on`/`supports` chains (`1..6` hops, cycle-aware), deduplicates primary witnesses by `source_key`, computes `independent_primary_witness_count`, flags `shared_upstream_warnings` when distinct dependent claims rely on the same single verse/source, and surfaces `challenges`, `counterexamples`, and `stale_dependencies`.
- **Ranking (`rg_search_v1`):** Ranks claims by independent primary witness count, review status, evidence class specificity, explanatory breadth, non-stale status, and penalty for unaddressed challenges—never by raw volume of AI-generated claims.

---

## 5. Security, RLS & Privacy Isolation

- All 7 `rg_*` tables have Row-Level Security enabled; direct `INSERT`/`UPDATE`/`DELETE` from `PUBLIC`, `anon`, and `authenticated` are revoked.
- `SELECT` policies on `rg_nodes`, `rg_claims`, and `rg_research_trails` expose only `public` + `published`/`active` rows or rows owned by `(SELECT auth.uid())`.
- Child tables (`rg_claim_participants`, `rg_claim_evidence`, `rg_claim_revisions`) and `rg_claim_links` require parent AND referenced target entities/claims to pass visibility checks—preventing private research leakage via indirect edges, backlinks, counts, or path queries.
- Read RPCs (`rg_*` queries) run `SECURITY INVOKER` with `SET search_path = ''`, `SET statement_timeout = '8s'`, `SET jit = 'off'`.
- Human write RPCs (`rg_save_batch_v1`, `rg_review_claim_v1`, `rg_delete_claim_v1`, `rg_save_trail_v1`) enforce kill switches (`note_settings.human_writes_enabled`), hourly rate limits, and ownership on private rows.
- Agent write RPCs (`rg_agent_save_batch_v1`, `rg_agent_delete_claim_v1`, `rg_agent_save_trail_v1`) are `REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO service_role;`, enforce `ai_writes_enabled`, `NOTES_AGENT_KEY`, agent ownership (AI cannot overwrite/delete human or other-agent claims), and always start AI claims as `review_status = 'unreviewed'`.

---

## 6. Seven-Tool MCP Integration & Website UI Parity

### MCP Surface (Preserving Exactly 7 Tools)

- **`research` operations added:** `kg_search`, `kg_dossier`, `kg_neighbors`, `kg_paths` (with `mode`: `source_only | algorithm_only | research_only | combined`), `kg_trace`, `kg_contradictions`, `kg_trail`; plus `notes_search` optional KG summary inclusion.
- **`write_Note` actions added (explicit user authorization required):** `kg_save_batch`, `kg_update_claim` (optimistic `expected_version`), `kg_challenge`, `kg_supersede`, `kg_save_trail`.
- **`follow_connectionchain` enhancement:** optional `layer_mode` (`source_only | algorithm_only | research_only | combined`, default `algorithm_only` for backward compatibility).
- **`get_prompt`:** Kept concise and backward-compatible for now; final Researcher AI methodology prompt update is deferred until after practical research evaluation.

### Website UI Integration & Human–AI Parity

- **Shared API:** `src/api/research-graph-types.ts` and `src/api/research-graph-rpc.ts` wired onto `BibleRPC.graph`.
- **`DiscoveryGraph.ts`:** Mode toggle (`Source & Algorithm` | `Research Graph` | `Combined`), accessible visual distinction for Scripture / Algorithmic / Human / AI nodes & edges, full connection explanation inspector (meaning, origin, evidence trace, limitations, counterexamples, Confirm/Dispute/Challenge/Supersede/Connect actions).
- **`ResearchGraphPanel.ts` & `ClaimComposerDialog.ts`:** Search, Concept Dossiers, Multi-Entity Path Explorer, Research Trails, and native `<dialog>` composer supporting n-ary participants, external empirical sources, claim-to-claim links, drag-and-drop connection presets, and `WordInspector.ts` integration.

---

## 7. Implementation, Deployment & Verification Record

- **Supabase Database Migrations (Applied Locally & Production `ejoperxiwxlcbsqrkrvb`):**
  - `20261126120000_research_knowledge_graph_schema.sql` — 7 `rg_*` tables (`rg_nodes`, `rg_claims`, `rg_claim_participants`, `rg_claim_evidence`, `rg_claim_links`, `rg_claim_revisions`, `rg_research_trails`), 42 predicates in `note_connection_types`, cycle/staleness enforcement, strict RLS, and zero-mutation separation from Layer 1/2 tables.
  - `20261126120100_research_knowledge_graph_rpcs.sql` — `rg_resolve_node_id_v1`, 9 `SECURITY INVOKER` read RPCs, 4 UI write/review RPCs, and 3 `service_role`-only `rg_agent_*` RPCs.
  - Production verification: `conn_types: 42`, `rg_tables: 7`, `rg_pub_rpcs: 17`, `anon_agent_exec: false`, existing `notes` (`total_notes: 213`, `pub_notes: 7`, `rem_notes: 206`) intact, security/performance advisors clean of RLS/initplan errors.
- **Local Bootstrap (`supabase/local/`):** `00_extensions.sql`, `00_production_schema.sql`, and `01_minimal_seed.sql` provide reproducible local Docker bootstrap without touching production.
- **Edge Function Deployment:** `bible-mcp` deployed to `ejoperxiwxlcbsqrkrvb` at **version `66`** (`https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp/mcp`, rollback target: `v64`), preserving the 7-tool interface (`get_Passage`, `get_Word`, `get_Connection`, `follow_connectionchain`, `research`, `write_Note`, `get_prompt`).
- **Website Deployment:** `bibleresearch` Cloudflare Worker deployed at **Version ID `aa654f45-a843-40e5-90dc-76c4c64e6a60`** (`https://bibleresearch.kingdomfishers-custom.workers.dev`, verified HTTP `200`).
- **Verification Results:**
  - `scripts/verify-research-graph.mjs` (local Supabase): all 4 adversarial & E2E suites passed (Schema/RLS/Grants & Zero Private Leakage; Zero-Contamination across 1,000 synthetic AI claims; Prompt-Injection, Partitioning, Echo-Chamber Shared-Upstream Warning, Cycle & Non-Transitivity Guards, Kill Switch, Idempotency & Key Checks; Bidirectional Human ↔ AI Parity & Existing Notes Integrity).
  - Live Topics A–E Multi-Session Evaluation (`v66` production MCP, 2 sessions across Seed/Info, Adam/Blood, Rev 1:20 Seven Lampstands control, Shaqed/Shaqad Almond wordplay, Salt/Covenant & ionic NaCl preservation; temporary `[EVAL]` rows removed afterward):
    - `S1:batch_ABCDE` saved 7 claims (`303 ms`, `5,623 B`); `S1:save_trail` (`108 ms`, `885 B`); `S2:dossier_H2233` (`187 ms`, `2,557 B`, `1` claim); `S2:paths_B` (`6,098 ms`, `3,735 B`, `2` paths with explicit non-transitive predicate warning); `S2:trace_B2` (`372 ms`, `2,101 B`, `independent_primary_witness_count: 1`, `shared_upstream_warnings: 1`); `S2:chain_combined` (`722 ms`, `1,820 B`, `2` `rg:` hops); `S2:challenge_B1` (`121 ms`, `1,419 B`, `challenge_ok: true` after fixing `kg_challenge` partial claim schema in `discovery-v2-tools.ts`); `S2:contradictions` (`127 ms`, `1,933 B`, `1` challenge returned).
  - Typecheck & build after final code edit: `npm.cmd run check:types` (`tsc --noEmit`) and `npm.cmd run build` (`vite build`, `137` modules) exited `0`; `npm.cmd run check:size` (`107` files) exited `0`.
- **Observed Operational Notes & Known Limitations:**
  - `S2:paths_B` combined mode (`kg_paths`) spent `~6.1 s` primarily from the concurrent `discover_subgraph_v1` call; passing `mode: "research_only"` is sub-second when only KG paths are needed.
  - Pre-existing UI write RPCs (`rg_save_batch_v1`, `rg_review_claim_v1`, `rg_delete_claim_v1`, `rg_save_trail_v1`) retain `SECURITY DEFINER` parity with `save_note_v1` (single-user / signed-in UI workflow gated by `note_settings` kill switches and rate limits).
- **Recommendations for Next-Phase `get_prompt` Methodology Update (Deferred):**
  1. Direct Researcher AIs to call `research(operations:[{op:"kg_dossier",...},{op:"kg_search",...}])` and `kg_trail` *before* launching broad corpus queries so prior challenges, open frontiers, and settled controls are loaded first.
  2. Enforce two-phase authoring: submit grounded batches with `write_Note(action:"kg_save_batch")` using `n-ary` participants for process/pattern claims, `TEXT_EXPLICIT` for defined symbols (e.g., Rev 1:20) vs. `DLM_HYPOTHESIS` / `SCIENCE_EMPIRICAL`, and HTTPS `external_source` rows for empirical mechanisms rather than fabricating verse anchors.
  3. Instruct agents to run `kg_trace` and `kg_contradictions` on foundational claims, using `write_Note(action:"kg_challenge")` (which omits redundant `claim_kind`/`predicate`/`evidence_class` fields) or `kg_supersede` rather than creating duplicate unlinked claims.
  4. Require explicit citation of `transitivity_warning` and `shared_upstream_warnings` when summarizing `kg_paths` (`mode:"combined"`) or multi-claim reasoning chains.
