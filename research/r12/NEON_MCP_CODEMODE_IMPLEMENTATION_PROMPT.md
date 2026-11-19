# Neon implementation prompt — Seven-tool compact BibleResearch MCP (v2)

**Role:** Neon, lead orchestrator / technical architect / integration and deployment owner. Delegate independent, well-defined implementation and test tasks to low-cost subagents; use stronger reasoning only for tricky architecture, source integrity, chain/session security and evaluation.

## Non-negotiable mission

Implement the owner's **exact seven-function AI-facing model** rather than the earlier proposed 3-tool or 8-tool interface. The two frequent functions are **\`get_Passage()\` and \`get_Word()\`**. They must return **just enough compact evidence to make surprising, genuinely useful hidden patterns visible to an AI without requiring it to request every connection explicitly**. The AI follows the interesting ones using \`get_Connection()\`, \`follow_connectionchain()\` and \`research()\`.

**Primary authoritative specification:** \`research/r12/MCP_CODEMODE_DISCOVERY_STRATEGY.md\` (updated v2). The older \`MCP_AI_DISCOVERY_REQUIREMENTS.md\` remains a source for evidence/DLM/prophetic constraints **but its eight-tool proposal is superseded**. Follow \`AGENTS.md\`, \`ARCHITECTURE.md\`, \`RELATIONSHIP_ARCHITECTURE.md\`, the real local workspace, \`PROJECTMAP.md\`, \`TASKS.md\` and the latest R12 deployment handoff. Local source is authoritative; inspect live versions and Git status before changing code.

**Do not stop after planning.** Implement, test, deploy and publish the new MCP interface with a factual handoff.

## 0. Inventory and single-source task plan

1. Inspect all existing registered MCP tools, annotations/schemas, Edge Function/Worker routing, corpus release, source/edition/license constraints, source integrity, website clients and notes security.
2. Preserve the existing 46-tool legacy surface until an explicit, tested compatibility migration is ready. Do not remove dataset access, change existing source evidence, or weaken write protection.
3. Identify reusable internals for \`get_verse_research\`, \`get_verse_hydrated\`, \`research_passage_lens\`, lexical lens, R9B relationships, R10/R12 discovery, LXX, Macula grammar/syntax, chronology, geography, DLM and notes.
4. Examine actual current failures/fallbacks, especially compact word lens and verse research. Distinguish transient unavailable from missing coverage; do not claim a prior failure persists without reproducing it.
5. Add an efficient, dependency-ordered implementation plan with owners/tests **to TASKS.md only**. Do not introduce competing trackers or duplicate architecture proposals. Assign non-overlapping subagent file ownership.

## 1. Exact seven user-facing MCP tools

Implement and expose these names (case-sensitive), with concise MCP descriptions and validated named JSON arguments. Provide short positional examples in documentation.

### A. get_Passage(passage, depth=z, word_depth=x, show_etymology=y, show_realworld=0)

This is the default study tool. Accept canonical book/chapter/verse and **inclusive cross-chapter ranges**; support \`1COR12:10-1COR13:4\`, Psalm verse 0 where present and bounded multiple selections.

- **depth (z)** = max z connections for the **complete passage** AND max z for **each verse**, separately.
- **word_depth (x)** = max x connections for **each word**. x=0 means return full **basic word capsule**, but **no word connections**.
- **show_etymology (y)** = 0 suppresses optional etymology/similarity. y>0 includes documented roots/derivations **plus max y orthographic/spelling candidates in a separate unverified field**. Never assert consonant similarity is historical etymology.
- **show_realworld (0/1)** = 0 omit, 1 include sourced physical/world definitions and linked concepts. No automatic theological proof.
- Default small depth, word_depth 0, etymology 0, realworld 0; compact notes summaries if authorized.
- Optional focused filters, source edition, date model, input budget, expansion cursors and evidence type selectors. Do not require configuration for normal usage.

Return **exact requested hierarchy**:
\`passage { passage_connections[top z], geography[{place,role,coordinates,confidence,source}], chronology{model,axis,date_or_range,alternatives,status}, verses:[ {ref, verse_id, complete_original, complete_english, verse_connections[top z], words:[ {original, lemma, transliteration, English gloss, senses, grammar code + explanation, lxx, optional etymology, notes, word_connections[top x], optional realworld} ] } ], coverage, release, cursor }\`.

Word order and verse range must be correct. Show actual readable complete verse texts and token glosses/transliteration, not just reference numbers and Strong IDs. Canonical word identity and morphology must be anchored to **the token occurrence**. Greek NT occurrence is not automatically an LXX alignment. The time/date and geography of a passage must not be invented (for example, a letter's recipient city is not its composition location; a model-specific 'year 4029' is not a universal date).

**Key acceptance call:** \`get_Passage("1COR12:10-1COR13:4",10,0,0)\`. The omitted fifth positional realworld argument defaults to 0. All 26 inclusive requested verses must remain readable via first response plus explicit continuation when a strict output cap requires it; z applies per passage and per verse, x=0 omits word connections, y=0 omits optional spelling/etymology, realworld off. Do not silently truncate, hallucinate or omit the words.

### B. get_Word(word, x, y)

Resolve English/Hebrew/Greek/transliteration/Strong's/lemma/exact occurrence. Preserve all relevant homographs and sense candidates; disambiguate rather than blindly selecting a single sense.

Return the *same canonical word object as get_Passage* enriched with grammatical form(s), attested senses in usage, LXX mappings with proper source direction, documented roots and separate spelling candidates (y), **gematria with named system/normalization and letter values**, attributed notes, up to x diverse connections with verses/evidence IDs, physical/real-world definition and connected concepts when available, and occurrence statistics with sample verses. Show exact Greek/Hebrew form and English/transliteration.

**Key acceptance call:** \`get_Word("Ruach",30,10)\`. Implement sane limits/cursors for large x and no fabricated data. Gematria varies by surface, normalization and Greek/Hebrew convention; do not copy an unverified hardcoded sum for \`ἄλλῳ\`.

### C. write_Note()

**Keep current authorized behavior**: saving/editing notes and DLM cards with exact verse/word anchors, provenance, author/review/visibility, explicit user authorization and rate/ownership checks. Expose compatible route/alias, not an insecure public write API. No automatic write from read or chain operations.

### D. get_Connection(items, x)

Accept **two or more words, concepts, or passages** (mixed allowed), return up to x typed, ranked meaningful connections, with *actual supporting biblical witnesses*, original-language anchors, graph route, alternatives, evidence class and next links.

**For word inputs** return their complete get_Word-shaped objects (within explicit bounds/continuations); **for passage inputs** return the passage's text/context and up to x connections, **not every word JSON**. Deduplicate where inputs overlap. Do not promote transitive edges into documented endpoint claims.

### E. research(query_or_plan)

One flexible interface for the AI to ask for advanced research, mixing search/compare/aggregate operations into one bounded response:
- lexical words/occurrences and co-occurrences (same verse vs clause vs nearby);
- typed grammar and syntax relations, passage-passage comparison, graph traversal, proof paths, LXX;
- gematria and numeric patterns with exact method/source;
- word-occurrence distributions by *named chronology model* and event/composition axis with undated denominator;
- places and events within supported geography, differentiating location role/uncertainty;
- real-world physical properties with source, DLM read and counterexamples;
- bounded aggregate/intersect/filter/project operations.

Support \`query\` (common deterministically recognizable natural-language requests, or supported-plan suggestion if too broad) or typed \`plan\` with operation DAG/allowlist and per-step coverage/error status. Never pretend the server runs an LLM on arbitrary prompts without a model. Prefer deterministic preindexed corpus methods and compact projected results.

**Do not run arbitrary AI-generated JavaScript inside Supabase or a normal Worker**. True Code Mode requires a properly isolated runtime, which may involve a paid Cloudflare option; free-tier-first Stage A declarative research must work without paid services.

### F. follow_connectionchain()

Remember a path across separate MCP calls: **start → follow → inspect → branch/back → reset**. Expose \`chain_id\`, revision, current node, short breadcrumb, new-edge evidence, concise next options, optional context, expiry and partial status.

Use server-side **ephemeral state** with a documented TTL, bounded size and optimistic concurrency; no permanent research-note claims. Authentication or unguessable scoped capability tokens must prevent cross-user access, enumeration and overwrites, including with today's unauthenticated public read endpoint. Keep chain IDs/tokens out of logs and public URLs. Return delta rather than full history. Verify that graph chains are still *hypotheses until endpoint evidence exists*.

### G. get_prompt()

Return a compact BibleResearch research workflow and tool usage guide, with optional subject profile (general, prophecy, DLM, word study, chain, challenge). Include when to use each function, counts/flags, what "complete" means, how to inspect witnesses and distinguish Bible facts vs interpretation. Ordinary get_Passage/get_Word should work without a preceding get_prompt.

## 2. Evidence/selection architecture

Implement one shared **compact structured word object** and one **nested passage object** rather than seven inconsistent payload styles. Ordinary passage response should expose interesting linguistic/biblical clues *through ranked passage/verse/word connection summaries* and local text structure; never flood with seven occurrences and letter matches for every stopword when x/y are zero.

For each connection: brief why-interesting reason + what is connected + relation/evidence type + relevance/strength category + *at least one* readable witness snippet + stable evidence/next-node ID. Inspect full witnesses on demand.

Ensure the most meaningful patterns — uncommon multiword or number/role/image combinations, explicit interpretations, strong intertextual reuse, contrasts, and sourced grammatical/lexical relationships — can rank above generic word pairs. Surprise is discovery priority, not proof.

Enforce deterministic z/x/y bounds and global output/CPU/fanout limits. Give explicit \`truncated\`, \`omitted\`, \`next_cursor\`, source coverage, license/edition/release, ambiguity and missing-upstream status; no silent incomplete answer. Group repeated lexical dictionaries and witness metadata to save tokens without breaking readability.

DLM entries, user notes, empirical science and model hypotheses must remain **separate epistemic classes**. Reuse existing note/security and provenance contracts. Do not invent missing DLM layer 0–7 definitions.

## 3. Parallel implementation strategy

Neon coordinates coherent interfaces first, then subagents by **non-overlapping source files**:
1. Passage/word packet and selection implementation.
2. Concept resolution, lexical details, LXX and gematria.
3. Connection evidence and ranking/graph adapters.
4. Secure server-side chain persistence.
5. Declarative research-plan executor with chronology/geography.
6. Test fixtures, MCP registration compatibility, skill/docs and prompts.

Use cheap implementation agents on exact, well-specified tasks and stronger review only where necessary. Integrate independently passing commits incrementally. Protect user's existing local changes and source datasets. If a task requires new paid services, irreversible migrations, deletion or lowering security, mark it blocked and continue safely rather than silently proceeding.

## 4. Focused acceptance tests; no expensive full benchmark

**Calls/expected shape:**
- \`get_Passage("1COR12:10-1COR13:4",10,0,0)\`: cross-chapter accuracy; complete original/English verse sequence, basic word structure, no per-word connections, no orthographic flood, no realworld, proper time/place statuses.
- \`get_Passage("Zechariah 4:1-14",5,0,0)\`: return meaningful top connections, including relevant Zech 4 self-explanation and Revelation 11 relationship, not mostly unrelated grammar; readable Hebrew and English.
- \`get_Word("Ruach",30,10)\`: original/transliteration, ambiguity, source-attested relatives vs speculative spelling, actual sample verses and defined gematria.
- \`get_Word("H3722",10,0)\` and \`get_Passage("Genesis 6:14",5,2,1)\`: expose relevant covering/pitch family and label a possible redemption analogy as non-explicit, with truthful realworld evidence.
- \`get_Connection(["Zechariah 4","Revelation 11:4"],10)\`: passage-level comparison without full per-word expansion; real verse witnesses and differences.
- Ezekiel 1 ↔ Ezekiel 10, Revelation 13 ↔ Daniel 7, Matthew 6:22 ↔ eye/lamp motif: nuanced, evidence-classed comparisons; no forced universal symbol sense.
- \`follow_connectionchain\` persists through separate requests/clients; rejects expired/forged tokens, conflicting revisions; branch/back and no source-edge laundering.
- \`research\` handles a typed multi-step word/grammar comparison, a specified gematria calculation, an explicit chronology-model distribution and event-vs-mentioned geography query; invalid plans cannot run SQL/network/code or perform note writes.
- \`write_Note\` preserves prior human/AI note semantics and denies unauthorized writes.
- \`get_prompt\` is correct, brief and consistent.

Run relevant unit/schema/security/build checks and **short bounded live smoke calls only**. Do not consume credits running the full 239-case benchmark; ChatGPT will later do independent comprehensive testing. Retain negative controls and regression tests.

## 5. Publish the interface

Register/expose seven functions at a documented **core** MCP endpoint/profile after testing while preserving the old 46-tool endpoint/profile and client compatibility. Update \`supabase/functions/bible-mcp/catalog.ts\`, related implementation modules, workflow-contract, workflow prompts, notes compatibility, appropriate manifests, skill/tool descriptions, \`MCP_SETUP.md\`, and **TASKS.md** to reflect actual deployed behavior. Avoid claiming core tool shrinkage if the client still sees 46 because of host caching; provide refresh instructions and actual \`tools/list\` response.

Deploy the new release using project procedures; verify live endpoint responses, real source/routing versions, security and selected acceptance fixtures. Record release IDs, commit SHA, rollback version, practical budgets, known limitations and deferred true sandboxed JS.

Create **\`research/r12/MCP_CODEMODE_IMPLEMENTATION_HANDOFF.md\`** describing what was actually implemented and how ChatGPT can independently test all seven tools. Push to GitHub. Final report: brief summary, links, verification results and clearly marked incomplete/blocked items.

**Execute end to end, not just planning.**
