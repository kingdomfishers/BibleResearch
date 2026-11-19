# BibleResearch — Discovery-First MCP and Code-Mode Strategy

**Date:** 2026-11-19  
**Status:** Authoritative proposed AI-facing interface design; no code or deployment changed by publication.  
**Repository:** kingdomfishers/BibleResearch  
**Relationship to prior documents:** Refines and supersedes the *default tool-count/interface recommendation* in [MCP_AI_DISCOVERY_REQUIREMENTS.md](MCP_AI_DISCOVERY_REQUIREMENTS.md), while retaining that document's detailed requirements for evidence quality, DLM, prophetic interpretation, source provenance, and safety. Does not supersede corpus contracts or RELATIONSHIP_ARCHITECTURE.md.

## 1. Fundamental goal

Make ChatGPT, Gemini, and comparable models dramatically better at finding **surprising, meaningful, demonstrable biblical relationships** and investigating them autonomously. A model should open an ordinary Bible passage and immediately see the linguistic, grammatical, symbolic, narrative, historical, spatial, and cross-book clues that make deeper research productive — not have to guess Strong's IDs or invoke twenty tools just to obtain context.

**Design principle: supply a rich, trustworthy *research context*, then let the model perform the interpretation.** The corpus/index/server retrieves and verifies; the AI notices, compares, proposes, asks further questions, challenges, and explains. Never present a graph score, gematria match, physical analogy, note, or speculative typology as a revealed textual fact.

## 2. Why Code Mode, and what to build on the existing free-tier architecture

Code Mode is a real MCP pattern: an LLM writes code calling a typed API; an isolated executor invokes multiple low-level operations and returns a selected, compact result. This can avoid repeated client/model turns and huge intermediate messages.

Cloudflare documents a codeMcpServer wrapper and isolated DynamicWorkerExecutor:
- https://developers.cloudflare.com/agents/model-context-protocol/guides/build-codemode-mcp-server/
- https://developers.cloudflare.com/dynamic-workers/examples/codemode/
- https://developers.cloudflare.com/dynamic-workers/pricing/

**As documented on 2026-11-19, Dynamic Workers require the Workers Paid plan.** Do not silently require a paid Cloudflare plan, paid model, new DB, or billing changes. Also do not execute AI-written JavaScript inside the Supabase Edge Function or ordinary corpus Worker without a genuine security boundary.

**Two-stage architecture:**

**Stage A (implement now, no paid infrastructure):** Three simple MCP read tools: **get_passage**, **get_word**, and **research**. The third accepts a strictly validated, declarative **research plan** (typed operations, arguments, dependencies, joins/aggregations/filters and output projection) rather than unrestricted JavaScript. The server is an interpreter of allowlisted read-only operations; the AI can orchestrate several operations in one call. A single plan can compare multiple passages, calculate word distributions, search location-indexed passages, traverse relationship graphs, compute specified gematria values, and return only the findings selected by the AI. This is *code-like composition*, not arbitrary code execution. It offers much of the tool-call/context benefit without a sandbox service.

**Stage B (optional future):** When a properly isolated execution environment is available, add an alternative **research_code** tool that executes bounded model-written JavaScript/TypeScript against the *same typed, read-only research operations*. Its executor must isolate untrusted code, deny ambient secrets/network/file access, limit CPU/time/memory/concurrency/output, proxy only allowlisted operations, and log calls. Keep Stage A available as a predictable fallback. Never market Stage A as actual JS execution.

**Architecture:** MCP facade in existing Supabase Edge Function -> reusable typed research service -> existing Cloudflare corpus shards/graph/fast verse indexes + selected source-controlled Supabase read RPCs. Deterministic computation and caching reside as close to immutable data as sensible. Supabase keeps dynamic/reviewed notes and related state. No new large immutable PostgreSQL tables; no large live corpus scans.

## 3. Default public interface: two reading tools plus one research orchestrator

Expose these three as the **default read-only ChatGPT/Gemini MCP tools** after compatibility is verified. Preserve existing 46 tools and any authorized note writers in a legacy/expert endpoint or compatible profile until callers, documentation and tests migrate. Do not remove note-writing authorization, history, or data; a separate explicit write tool may remain available only for approved writes.

### A. get_passage — most frequent call

**Input** (proposed):
- **reference:** one verse, contiguous range, several bounded ranges, or canonical book/chapter/verse coordinates; Psalm verse 0 supported.
- **profile:** quick | study | discovery | prophetic | deep. Defaults to **discovery** for passage study; quick for simple quoting when intent warrants.
- **focus:** optional question, word, image, theological motif, time/location filter, or requested relationship. Focus influences ranking, not the underlying verse evidence.
- **include:** optional subset of text, lexical, grammar, symbols, intertexts, events, numeric, chronology, geography, LXX, notes, DLM, alternatives, etc.
- **level:** summary | balanced | expanded; **budgets:** max_output_tokens, max_connections_per_word, max_passage_connections, max_verses and explicit pagination, subject to hard caps.
- **edition/translation:** precise supported edition and permitted translation; no silent replacement.
- **cursor/reference IDs:** continue/expand without repeating original packet.

**Always return** complete requested readable verse texts (unless explicitly requesting a summary) + original ordered words; Hebrew/Aramaic/Greek token and transliteration; selective gloss; stable occurrence identity; grammatical form/function where sourced; and coverage/release markers. **Do not force the model to work from Strong's IDs, original script alone, or verse numbers alone.**

**Discovery profile additionally returns:**
1. One context outline for the entire requested unit: speaker, narrative event, agents, actions, objects, imagery, local explicit explanations, genre, key recurring word/scene relationships and near context.
2. **Compact high-signal word capsules** for significant tokens: observed sense in context (if source-supported), alternative senses/homographs, attested roots and compounds, notable translation choices, morphology, clauses/roles, key biblical uses and uncommon meaningful associations.
3. **Word-pair/scene capsules** for combinations in the actual passage, such as "seven eyes + run through whole earth"; "lampstand + oil + Spirit"; "ark + pitch/coating". Prefer combinations, predicates and verse-based identity over isolated lexical neighbors.
4. **Ranked passage-level connections**: explicit self-interpretation, same-book reuse, quotations, well-supported allusions/structural transformations, exploratory motif connections, then statistical/orthographic candidates. Return both passages' actual texts, limited original-language anchors, why relevant, support class, reason for ranking and next evidence ID.
5. Compact **interesting clues** and **next questions**, not answers that presuppose doctrinal conclusions. Show 2–5 contrasting routes (linguistic, visual, literary, historical, physical, numeric) as available and justified.
6. Relevance- and quality-scoped DLM cards, clearly labeled as commentary, not canon. No DLM note found is not equivalent to no DLM interpretation possible.

**Selection budget:** Prioritize meaning-bearing words and relationships. Do not attach top-seven spelling candidates to every article, conjunction or common verb by default. Group repeated lexical metadata and reference by ID; have selective full expansion. Omitted for budget must not be confused with absent from corpus.

### B. get_word — lexical/conceptual exploration

**Input:** exact word occurrence (book/chapter/verse/position/edition), lemma/Strong's/extended Strong's, source-script form, transliteration, or English concept; optional sense selection; local context; profile, include layers, corpus slice, result cap and cursor.

**Return** source-resolved candidates instead of silently choosing an English-sense or homograph:
- Original, transliteration, readable English sense labels and contextual gloss; morphosyntax and morpheme boundaries when attested.
- Documented root/formation and compound components vs literary wordplay vs merely similar consonants (**distinct evidence classes**).
- Exact total occurrences and denominators with sampled book-diverse verses; switch to paginated exhaustive collection on explicit request.
- Contextual/grammatical partners: subject, object, modifiers, possessive/construct, same clause and proximity — measured distinctly; show roles and actual witness verses.
- Lexical links, LXX translations and translation-direction/edition caveats; related symbols and literary uses.
- **Most fruitful connections** from different relation families; offer expandable evidence IDs and why interesting, not just ranked proximity.
- Optional physical properties, chronology distributions, geographical usages and DLM commentary with explicit source boundaries.
- Clear ambiguity, source status, absence-of-data and counterexample prompts.

The AI should learn from the packet, for example that the Hebrew family surrounding Noah's ark coating in Genesis 6:14 deserves comparison with other *kaphar/kopher* uses involving covering or ransom. That is a **research lead**; a root relationship alone does not prove a claim that ark pitch is explicitly "redemption."

### C. research — one-call composable read-only analysis

**Input:** a *declarative research plan*, with a short goal/focus and array of allowlisted operations. Upstream tools/corpus APIs remain internal.

Suggested operation registry (each independently typed and tested):
- **resolve**: resolve references, exact word/lemma/sense/entity IDs, including ambiguous alternatives.
- **read_passage / read_word / inspect_evidence**: obtain exact underlying records.
- **find_verses / find_occurrences / find_collocations**: bounded lexical/phrase/motif searches with witness sets.
- **find_relations / expand_graph / find_paths / compare_passages**: typed graph retrieval, grammatical roles, R8/R10/R12 structural and intertextual comparisons, counterexamples and evidence checks.
- **analyze_structure**: repetitions, narrative actions, entity/number predicates, image configurations, optional chiasmus candidates with falsification checks.
- **compute_gematria**: explicitly named mapping (e.g. standard Hebrew), grapheme normalization, spelled text vs lemma selection, edition/orthography and independent controls. Never infer authorial intent from equal sums.
- **temporal_distribution**: count words/phrases/events across **explicitly named** chronology model and date buckets, with event versus composition dating, undated counts, model disagreement, true corpus denominator and uncertainty.
- **geographic_query**: passages/events located in a named region, polygon or bounded radius (if sourced), **distinguish event setting from place merely mentioned and symbolic/unknown geography**.
- **compare_lxx / inspect_syntax / lexical_formation / physical_properties / notes_read**: source-specific drilldowns with provenance.
- **aggregate / intersect / union / difference / group_by / sort / slice / project**: bounded server-side transformations over previously returned indexed result sets, without arbitrary SQL or script evaluation.

**Execution rules:** hard maximum operations, depth, fanout, source scans, rows, CPU and output size; allow only well-typed read operations; no arbitrary HTTP, SQL, file access or note writes. Give each step an ID and explicit dependency; validate graph acyclic, references typed, deduplicate subcalls, parallelize independent steps within bounded concurrency, cache immutable results by dataset release, and return per-step status/coverage/errors. Support atomic partial results with a report of missing steps. Client-requested projection controls final payload; evidence IDs remain accessible. Operator grammar and limits must be documented for AI-generated plans.

**Illustrative plan (proposal, not currently deployed):**

    {
      "goal": "Compare seven eyes and seven lamps with vision interpretations",
      "steps": [
        {"id": "z", "op": "read_passage", "args": {"reference": "Zechariah 4:1-14", "profile": "discovery"}},
        {"id": "v", "op": "find_verses", "args": {"concepts": ["seven eyes", "seven lamps"], "scope": "bible", "limit": 30}},
        {"id": "x", "op": "compare_passages", "depends_on": ["z", "v"], "args": {"source": {"ref": "z"}, "candidates": {"ref": "v"}, "mode": "vision", "limit": 8}}
      ],
      "output": {"select": ["z.context", "x.connections", "x.witnesses", "x.alternatives"], "max_tokens": 5000}
    }

The server must validate the *actual* parser shape and reject malformed plans; the example is a design, not a published contract.

**Optional real code mode** could write familiar JS/TS such as a Promise.all over read operations, then run grouped counts and return a concise packet. Provide generated type definitions and examples only *after* a secure isolated executor is available.

## 4. Discovery Context Packet: the core innovation

This is the main deliverable. An AI should see an **interconnected local knowledge graph** in a compact readable representation, not a disorganized JSON dump.

### 4.1 Stable layers, in presentation order

**Layer 0 — passage context.** Requested actual verses with adjacent setting, speaker, scene, key actions, explicit interpretations, covered source versions.

**Layer 1 — ordered tokens.** Exact original word, transliteration, gloss, lemma/occurrence anchor, morphology, syntactic role; full ordered sequence for every requested verse.

**Layer 2 — lexical enrichment.** For relevant words, contextual senses and alternatives, compounds/roots, wordplay, spelling candidates (clearly separated), LXX bridging, counts, sample occurrences, common constructions and selective notes.

**Layer 3 — relational structure.** Clause/participant relations, motif/number/object inventory, interactions and repeated configurations; e.g. "7 eyes ↔ run through earth ↔ LORD" or "two olive trees ↔ lampstand ↔ oil ↔ Spirit". Subject/object is not automatically semantic agent/patient.

**Layer 4 — corpus bridges.** Meaningful passage-to-passage links by explicitly labeled mechanism: source self-interpretation, quotation, probable allusion, narrative analogy, symbol transformation, grammatical relation, lexical comparison, numerical observation, and exploratory external property. Include actual verses on both ends and precise witness/source IDs.

**Layer 5 — exploration controls.** Alternative interpretations, negative controls, weak-support flags, source gap markers, next research nodes/cursors and concise reasons each candidate matters.

**Layer 6 — interpretive DLM overlay (optional).** Explicit Scripture observations, textual comparisons, *independent empirical physical claims*, and hypothesis-layer mapping as **separate entities**, not promoted proof. Source the exact DLM layer 0–7 taxonomy from authoritative project materials; do not invent layer definitions.

### 4.2 What makes a connection "interesting"

Assign a **discovery priority** separately from evidence strength:
- Passage relevance and explanatory fit.
- Distinctiveness / rarity of *composite motifs*, not only words.
- Independence and specificity of biblical witnesses.
- Meaningful transformations (same image, changed role/number/action/setting).
- Interpretive leverage: explains multiple observed details together.
- Surprise and capacity to generate a testable next question.
- Diversity across evidence families (linguistic, structure, narrative, symbol, historical, geography/physical, numbers).

**Never use surprise, semantic similarity, shared consonants, gematria or co-occurrence as a substitute for textual support.** An interpretation's confidence is determined by its underlying warrant, scope and alternatives, not just score.

### 4.3 Examples the new packets should enable

**Noah's ark, Genesis 6:14:** Show the precise Hebrew coating/pitch tokens, documented lexical family distinctions, source-sense contexts, relevant occurrences (e.g. uses of ransom/atonement language where attested), and the actual verses. Present possible theological resonance as a *testable literary analogy*, not automatic etymology or authorial claim.

**Zechariah 4 and sevenfold imagery:** Supply seven lamps/eyes, olive trees, oil, Spirit, Zerubbabel and the explicit explanation in v.6 and v.10–14. Offer Ezekiel 1/10, Revelation 1/4/5/11 and Matthew 6:22 as differently classified research routes; **do not identify seven eyes with seven spatial directions unless a textual witness supports it**. Distinguish lamp as eye metaphor from a direct interpretation of the tabernacle menorah.

**Ezekiel 1:** Visions of creatures, wheels, spirit, glory and throne; highlight Ezekiel 10's identification of living creatures as cherubim and compare Revelation 4 with similarities/differences.

**Revelation 13:** Prioritize Daniel 7's distinctive sea-beast, lion/bear/leopard, horn/kingdom combination, not generic head/corner or horn roots. Preserve Revelation 12 dragon identification, alternative theological readings and later Revelation context.

## 5. AI-optimized output contract

All public responses must be readable by models and humans while minimizing repeated tokens.

**Mandatory top-level fields:** status; schema_version; normalized_query; corpus/graph/lexicon releases; source edition(s); english_translation license; actual requested passage text; coverage by dataset; completeness/is_exhaustive; payload_budget; errors/warnings; continuation_cursor; evidence IDs and expansion hints.

**Per selected word:** canonical verse/position/part, original and transliteration, short gloss, lemma ID + ambiguity, morphology and source attribution; groups of relationships tagged lexical/grammatical/contextual/intertextual/hypothesis.

**Per connection:** both canonical witnesses in readable English (or explicit restricted status), relevant original tokens and transliteration; exact mechanism and scope; direct versus indirect endpoint evidence; independent source groups; strength and alternative explanations; why-interesting sentence; evidence_id; stable exploration node.

**Response profiles:** quick small, discovery moderately compact, deep explicitly requested. Hard byte/token limits must be verified. Don't make the default large passage hydration explode linearly by attaching seven full occurrence lists to every word. Group shared lexical info once and use references; select high-signal words but always preserve ordered original words. Distinguish "not in selected summary" from "not found"; avoid confusing sampled results with exhaustive corpus scans.

**Failure and completeness states:** ambiguous, not_covered, not_found, restricted_by_license, incomplete_due_to_budget, transient_upstream_failure; no silent fallback to an inaccurate edition or fabricated metadata. Reports of missing data may include a reliable alternate lookup path.

## 6. Security, correctness and compatibility

1. Preserve exact identity across STEP, Macula, morphology and LXX; respect Psalm headings, versification shifts, per-word occurrence position, edition variants, cross-verse syntax and historical releases. Do not reconstruct unseen source relations or restricted semantic frames.
2. Use existing release-pinned read-only Worker endpoints; retain source license gates and scientific citations.
3. **Public read calls may not inherit note-write privileges.** Keep existing authenticated writes separate, explicitly authorized, auditable, rate-limited and reviewed.
4. Research plans must be AST/JSON validated, allowlisted, bound to quotas and protected from injection; no arbitrary SQL, JS execution, shell, eval, Function, fetch or unrestricted loops in Stage A.
5. No model-generated "verified" textual edge should enter immutable corpus. Model interpretation and user notes stay separate and labeled.
6. Maintain previous MCP endpoint and legacy clients until tool discovery and app usage are verified; introduce a separately identifiable *core connection/profile* instead of abruptly deleting 46 functions. Host/client schema refresh may be required.
7. Avoid paid dependencies; check Worker free-tier CPU limits and stage heavy indexing offline. Add runtime budgets and graceful partial responses; never perform an unbounded long-running request.
8. Source docs may disagree about deployed versions (MCP_SETUP.md vs the recent R12 handoff). Discover actual versions before release, capture rollback references and test production only with bounded calls.

## 7. Build order and acceptance checks

**Phase 0 — Baseline inventory:** inspect AGENTS.md, TASKS.md, actual deployment, source and tool list, [MCP_AI_DISCOVERY_REQUIREMENTS.md](MCP_AI_DISCOVERY_REQUIREMENTS.md), R12 diagnosis/handoff and workflow contracts. Verify existing data availability and failover routes (the live word-lens/verse-hydration spot tests showed availability problems in some queries even though the light passage lens worked). Confirm requirements from the current DLM framework rather than guessing.

**Phase 1 — Packet and selection engine:** define typed Discovery Context Packet schema, source integrity, hierarchy and compact selection; implement a deterministic source-driven composer using existing APIs. Add tests for multi-verse range handling, original tokens, provenance, useful notes, pagination and source gaps.

**Phase 2 — get_passage:** implement quick/discovery/prophetic/deep profiles and nested evidence; optimize meaningful compound imagery and explicit in-text explanations. Validate against Genesis 6:14, Zechariah 4, Ezekiel 1, Revelation 13, and ordinary narrative/poetry.

**Phase 3 — get_word:** add robust resolution, morphology, contextual uses, lexical formations, total counts, grammar, cross-language, graph evidence and paginated deeper exploration. Test homographs and missing data, same-spelling-not-root controls.

**Phase 4 — research declarative plan:** implement a minimal safe operation registry first (read, occurrences, graph, comparison, aggregation), then extend to gematria, chronological occurrences and geographical passage searches using existing indexed corpus. Add cross-operation referential checks, budgets, negative controls and accurate coverage. Write AI-facing plan examples.

**Phase 5 — Core MCP catalog:** register three user-facing read tools with concise descriptions, optional expert mode/legacy endpoint. Update MCP prompts, scripts, skill references, plugin manifests and docs; do not drop compatibility endpoints or writes.

**Phase 6 — Smoke tests and deployment:** inspect only a handful of representative calls per feature; no complete 239-case ChatGPT benchmark in the agent budget. Build/tests, security/provenance checks, live version verification and rollback; deploy according to project procedures and publish handoff for independent ChatGPT retest.

**Definition of success:**
- ChatGPT can call get_passage once for Zechariah 4 and see **all verse texts, ordered original language words and meaningful links** to Revelation 11:4, plus relevant alternatives and explicit symbol interpretation with source evidence or clearly marked coverage gap.
- A question about Genesis 6:14 presents the kaphar/kopher covering family in an accurately qualified form, without saying etymology proves redemption.
- A question on Revelation 13 surfaces Daniel 7's composite imagery above generic grammatical neighbors in the top contextual discoveries.
- A model can perform in one research plan a **bounded** multi-passage comparison, an exact-parameter gematria check, a chronology-model-specific distribution, and a geography query where sources exist, returning only selected supported evidence. Each operation independently reports coverage.
- No uncontrolled code execution, no write-privilege escalation, no source identity corruption and no requirement to purchase a Cloudflare plan.
- AI-facing tool count and average round-trips improve *without sacrificing truth*, with readable English plus original text/transliteration always available.
- Full legacy MCP tools remain functional until intentionally retired with a tested migration.

## 8. Orchestrator instructions and related docs

Implementation handoff: [NEON_MCP_CODEMODE_IMPLEMENTATION_PROMPT.md](NEON_MCP_CODEMODE_IMPLEMENTATION_PROMPT.md). Neon should integrate verified tasks into **TASKS.md only**, delegate bounded tasks to low-cost subagents, use live tests sparingly, and finish with a deployed version plus an explicit independent-ChatGPT handoff.

Existing foundation:
- [AI discovery architecture and prophetic/DLM evaluation](MCP_AI_DISCOVERY_REQUIREMENTS.md)
- [R12 algorithm improvement handoff](R12_ALGORITHM_IMPROVEMENTS_HANDOFF.md)
- [R12 benchmark diagnosis](R12_BENCHMARK_DIAGNOSIS.md)
- [Relationship architecture](../../RELATIONSHIP_ARCHITECTURE.md)
- [MCP tool catalog and server registration](../../supabase/functions/bible-mcp/catalog.ts)
- [MCP workflow contracts](../../supabase/functions/bible-mcp/workflow-contract.ts)
- [Current MCP setup notes](../../MCP_SETUP.md)

**Core success principle:** A better tool is not one that returns *more data*; it is one that presents more **truthful, interpretable, unexpected and testable relationships** per model token and allows the model to follow them naturally.
