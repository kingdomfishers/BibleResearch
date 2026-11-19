# Neon orchestrator prompt — AI-first BibleResearch MCP, three-tool discovery interface

**Role:** Neon, lead orchestrator/architect, integration and deployment owner. Use parallel low-cost subagents for independent bounded implementation work; use stronger reasoning only for source-integrity, tool contracts and cross-cutting design decisions.

**Mission:** Turn BibleResearch's existing MCP into a discovery instrument that lets ChatGPT, Gemini and other AIs **see unexpected, evidence-supported biblical connections without knowing in advance which specialized tool to call**. The two routine operations must be **get_passage()** and **get_word()**, with a third **research()** that combines advanced corpus operations in a single, safe, read-only plan. Make ordinary verse research rich, readable and useful; enable optional deeper queries into grammar, LXX, connections, gematria, chronology, geography, recurring image configurations, DLM hypotheses and negative controls.

**Primary specification (read first):** research/r12/MCP_CODEMODE_DISCOVERY_STRATEGY.md. Also consult research/r12/MCP_AI_DISCOVERY_REQUIREMENTS.md, research/r12/R12_ALGORITHM_IMPROVEMENTS_HANDOFF.md, RELATIONSHIP_ARCHITECTURE.md, ARCHITECTURE.md, AGENTS.md, PROJECTMAP.md and the pertinent open sections of TASKS.md. Local workspace remains authoritative; GitHub is not a substitute for checking actual source/deploy state.

## Non-negotiable product goal

A question about Zechariah 4 should return the **actual passage in readable English**, ordered Hebrew with transliteration/gloss/grammar, the relationships *among* its eyes, lamps, trees, oil and Spirit, the vision's own explanatory statements, meaningful connections to Revelation 11, and clear avenues for further investigation. A request for Genesis 6:14 should expose the source-grounded kaphar/kopher family and relevant uses without asserting that a root connection proves a redemption interpretation. Revelation 13 should surface the distinctive Daniel 7 image-combination before generic horn or head word associations.

**Do not optimize for raw quantity of facts. Optimize for meaningful discovery per model token, precise evidence, source transparency, reusable follow-up IDs and exploration flow.**

## Phase 0 — Inventory and small architecture plan

1. Inspect Git status, deployed MCP/corpus version, existing registered 46 tools, source code and free-plan constraints. Check for local uncommitted changes and preserve them.
2. Map legacy functions from catalog.ts, research-lenses.ts, verse-hydrated.ts, relationships-v2.ts, syntax-research.ts, notes-tools.ts and dlm-notes.ts to underlying read operations. Identify which compose reliably and which currently fail. Verify actual Worker/Supabase routing before designing anything.
3. Confirm current source/edition constraints, release IDs, migration/rollback, note authorization and existing DLM taxonomy. Never invent DLM 0–7 meanings.
4. Record a concise design and actionable dependency tasks **in TASKS.md (single source of truth)**; create no second task tracker. Divide tasks by owned files so subagents can run simultaneously.

## Phase 1 — Discovery Context Packet (shared foundation)

Implement a reusable versioned, typed packet builder over existing validated corpus evidence. Required:
- Full requested actual verses in legally renderable English, ordered original tokens, transliteration, short gloss, exact occurrence identity, edition, morphology and available syntactic function.
- Compact, source-grounded lexical capsules for **significant words**, including alternative senses/homographs, documented formation/root, measured occurrences and diverse representative witness verses; do not hydrate every stopword with a huge connection list.
- A *passage scene and relationship summary*: speaker, images, actors, objects, actions, number-noun pairs, grammatical relations, repeated multiword motifs and local **explicit** explanations.
- Ranked, diverse **passage-level** and word-level connections with both readable witness texts, original anchors, mechanism, an explanation of why the comparison matters, evidence ID, source/provenance, epistemic class and follow-up node. Prioritize explicit local interpretations and distinctive multiword intertexts over generic lexical associations.
- Counterexamples, unresolved alternatives, honest negative/missing-data results, DLM notes clearly marked as untrusted commentary, coverage/release/version flags, cursor, and budget/truncation metadata.
- Presets quick | discovery | prophetic | deep, include filters and hard size/fanout limits. A compact response must still retain the full words of each *requested* verse unless the request explicitly opts for summarization; if range exceeds bounds return an actionable partial/continuation rather than fake completeness.
- Deduplicate shared lexical data and support selective follow-up retrieval by stable occurrence/evidence IDs.

Build source-unit tests before large implementation changes; use existing corpus snapshots and releases.

## Phase 2 — Implement get_passage()

Support one verse, contiguous ranges and bounded multiple passages, optional focus and evidence-layer flags; distinguish source edition, symbolic/historical interpretation and whole-passage narrative context. Default to a **discovery** profile, not a dictionary dump.

Ensure explicit text-internal explanation and meaningful *composite* imagery are surfaced by the default ranker for prophetic inputs. Require both-side actual Bible verse texts and transcriptions/transliterations in important comparisons. Use existing indexed R10/R12 data and graph classes; do **not** create a new uncontrolled AI-inferred graph or hardcode benchmark answers.

## Phase 3 — Implement get_word()

Accept a canonical token occurrence, Strongs/extended Strongs, Hebrew/Greek lemma or surface, transliteration, or English concept with candidate senses. Return rich contextual lexical evidence, documented roots/formations separated from wordplay and spelling candidates, occurrences with source scope, grammar/partners, LXX bridges, relationship types, geography/temporal usages if requested, and diverse actual verses/next links.

Use accurate count denominators. A shared spelling is not a shared sense; a shared root is not a synonym; a Hebrew↔Greek correspondence is not automatic equivalence. On an unavailable backend, return a clear component status and validated fallback rather than a silent gap.

## Phase 4 — Implement research() — free-tier composable analysis

**Implement Stage A, not arbitrary JS execution.** Accept a typed *declarative plan* with allowlisted operations, named results/dependencies, bounded filtering/aggregation, output projection and per-step status. Support at least:
- passage/word/evidence reads and exact reference resolution;
- lexical occurrence, shared passage and relational path searches;
- multi-passage comparison, grammar and structural motif evidence;
- deterministic aggregation/intersection/grouping over bounded results;
- specified gematria systems with orthography rules and no theological proof leap;
- **time-series occurrences** using named competing chronology models and distinct event vs composition axes, undated counts/denominators;
- **geographic passage/event search** by supported place/region/bounding geometry, respecting event setting versus merely mentioned/symbolic places;
- LXX alignment and counterexample/disconfirmation searches where existing data supports them.

No arbitrary SQL, eval, Function, unrestricted loops, external fetch, shell or note writing. Validate plan schema, steps/dependencies, authorization, source access, CPU/operation/row/byte limits and retry/error behavior. Batch/parallelize independent reads with bounded concurrency. Return only the AI-requested projected evidence and stable IDs, plus coverage and omitted-step notices. If a source capability is missing, mark it unavailable rather than simulating results.

**Real code mode** is optional later (research_code() only in a securely isolated sandbox). Cloudflare Dynamic Workers currently require the Paid plan; do not purchase, enable billing or turn on a paid dependency. Do not advertise Stage A as executing JavaScript.

## Phase 5 — Interface and compatibility

Make the **default** MCP read-only catalog show get_passage, get_word and research with small, precise descriptions, schemas and use-case examples. Offer legacy/expert tools via a separately identifiable compatible profile/endpoint or a proven client-safe mechanism. Do not remove or break the existing 46 tool names, website RPC clients or authorized note-writer functions. Keep read and write security boundaries distinct.

Update existing skill/tool-reference descriptions, client manifests, MCP docs, WORKFLOW routes and automated verification to point to the new default behavior. A user should not need to call get_research_prompt just to do an ordinary verse study. Document how ChatGPT/Gemini refresh schemas. Preserve edition/rights restrictions.

## Phase 6 — Small tests, integration and deployment

Build through **file-separated subagents**. Neon owns shared types/interfaces, TASKS.md, integration, release verification and deployment. Give inexpensive agents exact files and deterministic acceptance criteria; request only necessary context and review before merge.

Run *focused* unit tests and representative live checks after each step, not the full 239-case benchmark. At minimum test:
- Genesis 6:14 / H3722–H3724 coating and ransom lexical family, with no claimed theological proof.
- Zechariah 4:1–14, explicit Spirit explanation, seven eyes and the Revelation 11:4 reuse, original languages and readable verses.
- Ezekiel 1 and explicit later cherub identification in Ezekiel 10.
- Revelation 13 and composite Daniel 7 beasts, avoiding high-score generic horn/head distractions.
- Homograph/sense, LXX source and Greek/Hebrew morphology controls.
- One gematria parameterization, one historical-timeline distribution, one geography setting-vs-mentioned-place query, malformed-plan/security tests, CPU/rate limits, sparse-source/coverage cases, 503 retry/fallback and no-note-write-in-read tests.

Do not rewrite the frozen historical benchmark. Do not claim independent success from cherry-picked tests. ChatGPT will run the large independent benchmark after deployment.

After passing tests, publish a **new verified MCP release** following existing project deployment rules. Check actual live tools/list, response schemas, corpus release and successful small end-to-end calls. Keep a rollback version. Git commit/push all source and updated TASKS.md, maintain existing history, and create:

**research/r12/MCP_CODEMODE_IMPLEMENTATION_HANDOFF.md**

Include new default endpoint/how to refresh, exact version and release IDs, Git SHA, actual implementation scope, operations, fallback/limits, focused test outputs, security/provenance checks, deferred code-execution features, known gaps, and clear independent ChatGPT benchmark instructions.

**Do not stop at writing a plan. Implement, integrate, verify, deploy and provide links.** Never perform destructive SQL, delete unique data, weaken authorization, or enable paid features without explicit separate approval.
