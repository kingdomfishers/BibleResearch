# BibleResearch — Astra execution directive: R12 discovery-first plan and immediate implementation

**Date:** 2026-11-17  
**Purpose:** One-time high-reasoning architectural handoff and first executable slice, followed by low-cost scoped implementation tasks.  
**Authoritative environment:** Windows local checkout `C:\Projects\BibleResearch-r10` (user's newest local R11/R12 code), not GitHub main.  
**Current user-reported state:** D1.1–D1.3 undertaken and **D1.3 finished**. Inspect completion evidence and do not rerun completed phases without a concrete regression.  
**Desired outcome:** Functional, explorable hidden biblical relationships in a live test build and through ChatGPT MCP, as early as possible.

## 0. Execute now, not just plan

You (Astra) must do **both** of the following in this session:

**A. Architectural work (your highest-leverage reasoning):** Reconcile actual local code and status with this directive and research handoff, make difficult compatibility decisions, rewrite the R12 section of `TASKS.md` as a shorter, implementation-complete, dependency-aware execution queue, and synchronize a byte-identical backup `R12TASKS.md`. The tasks must be **self-contained implementation prompts** designed to be executed by lower-cost models, not high-level tickets.

**B. Immediate implementation:** After the queue is safely updated, **execute the earliest unblocked end-to-end vertical slice**, not another proposal: exact word occurrence click -> existing direct typed evidence neighbors -> compact UI and MCP/Worker response -> actual proof expansion if available. Choose the smallest source-compatible increment that results in visible functionality. Complete tests, create a commit, **push your feature branch**, and deploy to an appropriate live *test* environment if its existing safe configuration allows. If a public-facing deployment requires credentials/access that cannot be provisioned safely or the current source is incomplete, still finish a verified local milestone, push it, and report the exact blocker. Do not stop after planning unless no safe code change is possible.

**Do not spend Astra resources implementing routine conversions or rewriting existing data processors.** Your work should eliminate ambiguity and prevent lower-tier agents from making architecture mistakes. Solve genuinely hard interface decisions now, then hand routine tasks to them.

## 1. Read the exact sources; authority and concurrency

Read in this order, only as much as actually required:
1. `AGENTS.md` and its referenced pre-code/post-code instructions, current Git status/branch, existing unfinished changes, current local `TASKS.md`.
2. [R12_Plan.md](https://github.com/kingdomfishers/BibleResearch/blob/main/R12_Plan.md) — comprehensive discovery architecture, algorithms, resource/licensing research, deployment boundaries.
3. [research/r12/README.md](https://github.com/kingdomfishers/BibleResearch/blob/main/research/r12/README.md), [R12_DB_DESIGN.md](https://github.com/kingdomfishers/BibleResearch/blob/main/research/r12/R12_DB_DESIGN.md), [evidence-contract.schema.json](https://github.com/kingdomfishers/BibleResearch/blob/main/research/r12/evidence-contract.schema.json), [data-sources.json](https://github.com/kingdomfishers/BibleResearch/blob/main/research/r12/data-sources.json).
4. Relevant sections only of local `RELATIONSHIP_ARCHITECTURE.md` v5, and of R11 audit/157 fixtures.
5. Existing local R8/R9C/R10/R11 implementations around the exact changes (avoid whole-repo searches that repeat previous work).

**Local checkout wins.** Main on GitHub is older than the user's local R11/R12 worktree. The R12 research folder was published separately on GitHub main. Bring those **specific research files** into local by a safe method (e.g. `git fetch` plus `git show origin/main:research/r12/FILE > ...` on Windows, or targeted downloads); do **not** merge/checkout older main over the local branch. Do not assume remote R11 branch exists. Preserve unrelated in-progress changes.

Task status may have evolved: user reports D1.3 finished. Verify D1.1–D1.3 against local report and logs, record actual DONE/PARTIAL/BLOCKED. Treat **D1.3 as reported complete**, no gratuitous rerun or reimplementation. D1.4 holdout can be reduced to an early narrow guard plus independent later final release test; never delete protected original fixtures.

**Backup invariant:** `TASKS.md` remains the authoritative task queue; `R12TASKS.md` is an **identical copy of the *entire* file**, not an R12 excerpt. After updating task status, recopy and verify SHA-256 equality. Commit/push both. Only one agent writes these two files at a time.

## 2. The product, precisely

BibleResearch is a **discovery instrument**. For *any indexed Hebrew or Greek original-language word* the user should be able to:
- Click a real occurrence in scripture and immediately see existing direct lexical, grammatical, cross-reference, source-root, transliteration, related-object/concept and contextual neighbors, with scope and source links.
- Explore **ranked 2–5 meaningful-hop paths** across lexical senses, grammar, statements, images, numbers, events, physical-world properties and verses. Clicking an intermediate node continues exploration; alternative independent proof routes remain available.
- Discover **unanticipated spelling overlap** (e.g. אדם / דם), candidate etymological/derivational leads, shared roots, polysemy, form relationships and possible wordplay. Treat form similarity as **candidate**, not historical etymology.
- Discover **structural parallels** using attested scene roles and rarity-weighted feature matching, e.g. Hagar's seeing/water encounters, without hardcoding Hagar or other examples.
- Reveal the distinct textual pathways through `ruach` (spirit/wind/breath/direction), lamp/menorah, Spirit, seven lamps and seven eyes (Exodus 25, Zechariah 4, Revelation 4–5), without collapsing Rev 1:20 lampstands/churches with Rev 4:5 lamps/spirits.
- Use **external semantic and physical knowledge** as candidate bridges (source-backed water/material/light/fire/anatomy concepts) after the core product functions. Do not assert that science is scripture.
- Expose the same data through an excellent, mobile-friendly **WordInspector/DiscoverConnections UI** and **BibleResearch MCP**, including a paged exploratory tail beyond the top-ranked 24 cards so human researchers and ChatGPT can pursue overlooked relations.

**Discoveries need not be perfect or prove the author's intent**. They must be real source-anchored observations or clearly marked algorithmic research leads, not invented passages, roots, etymologies, or symbol identities. Explanation distinguishes textual facts, linguistic attestations, external science, later reception and hypotheses. The system's objective is *novel, interesting, interpretable connections with traceable evidence*, not conservative retrieval of known curated references.

## 3. Reuse the actual stack

The project already has:
- MACULA/BibleOntology grammatical syntax extraction; R8 ~150,522 grammatical frames; source-local occurrence relationships.
- R9A lexical/source relationships; R9B canonical graph and sharded adjacency.
- R9C concept resolver, multihop-search.ts, adjacency-loader.ts, path-ranker.ts.
- R10/R11 discover functionality, WordInspector.ts, DiscoverConnections.ts, r10-rpc.ts, Worker corpus gateway, MCP wrappers.
- Supabase canonical identity/senses/roots/forms/concepts/notes/source-rights registry; immutable static corpus belongs in Cloudflare assets.

**Read-only live schema findings:** Supabase already has ~82,485 canonical entities, ~26,179 lexical senses, 744 lexical formations, ~15,642 entity relationships, ~8,864 concept_properties and ~2,119 concept_external_links. The latter properties/links overwhelmingly encode **geographical metadata**, not the desired physics/material/light knowledge. Do not re-import geography as a supposed "scientific concept graph" or create bulk PostgreSQL graph tables. `research/r12/R12_DB_DESIGN.md` has exact observed reuse.

Do not start another independent discovery algorithm stack. Extend existing R9C traversal and existing Cloudflare static asset manifests/reader with offline-generated adjacency/recommendations/proofs; maintain legacy release compatibility. Do not rebuild immutable MACULA/R8 resources without measured need. Identity joins do not consume *semantic* hop count, but a separate physical transition/read bound prevents runaway search.

## 4. Four algorithm prototypes are already written on GitHub — integrate, don't redesign

Published source and focused tests under [research/r12](https://github.com/kingdomfishers/BibleResearch/tree/main/research/r12):

1. `orthographic-candidates.mjs` + tests: generic Hebrew consonantal/Greek spelling similarity; matched-character explanation; no invented derivation. Integrate as an **offline compiler pass**, backed by canonical word-form/lemma identifiers, not glosses.
2. `structural-candidates.mjs` + tests: rare-feature postings + IDF-weighted Jaccard; accepts **already extracted** MACULA/R8 statement/scene features, does not parse Hebrew or infer participants. Integrate to existing pattern compiler with exact witness IDs and scene/edition scope.
3. `property-bridges.mjs` + tests: bounded physical-world assertion joins; verified vs candidate mapping and publisher source/rights; rejects geocoding identifiers as properties and generic hypernym hub flooding. No assertion of biblical symbolism.
4. `proof-ranker.mjs` + tests: provenance-aware evidence scoring/convergence/diversity/MMR; takes paths from existing R9C, no second traversal engine.

Also `evidence-contract.schema.json`, `data-sources.json`, database design and read-only SQL. These are **starting code**, not certified live features. Their isolated synthetic tests passed in a JavaScript smoke harness; *verify them against the local Node/TS toolchain, correct defects and adapt to actual source/graph contracts*. Avoid naively adopting the prototype ranker if the local R9C ranker already contains equivalent logic: transplant only missing units, retaining **one authoritative implementation**.

**Implementation order:** first existing direct graph -> UI/MCP; then existing-graph offline multihop + evidence; then import these four prototype feature passes and rerun a real-source pilot; only then pilot licensed **Open English WordNet** (modern semantic classes) and a compact **Wikidata** structured property extract. ENVO/ChEBI/PATO/Uberon/Pleiades/Sefaria only on measured missing information, not as a universal import prerequisite.

## 5. Optimize the original 35-task queue (roughly 12–18 actionable tasks)

The task count is secondary to minimizing engineering time, rework and AI token consumption. Retain verified completed D1 tasks with original statuses/acceptance evidence and an old->new mapping. Aggressively merge duplicate scaffolding, overlapping graph/ranking subtasks and needless full rebuilds, without dropping source integrity or important holdout verification.

**Milestone A — working direct discovery, earliest possible live demonstration:** correct typed original-word anchor -> direct graph neighbors and available lexical/form roots -> WordInspector automatic cards -> same response/evidence through MCP. Uses **existing corpus** and no new external data. Test Hebrew, Greek, common/high-degree and no-result cases.

**Milestone B — working hidden multihop discovery:** extend the **existing** R9C offline mode with bounded typed 2–5 meaningful-hop beam (64 beam, 16 diverse outgoing as initial parameters), proven source step types/directions, independent evidence groups, duplicate suppression, ranking, alternate paths + exploratory cursors. Precompute a small 40–60 ordinary-anchor pilot, stage immutable asset pages, show real multi-step proofs via UI/MCP. No target words hardcoded in production algorithms. **This milestone must precede broad data imports**.

**Milestone C — more surprising relationships:** adapt the published orthographic and structural compilers, and source-scoped physical bridge/ranker, using actual R8 and lexical sense data; measure new sources, false positives and discovery yield on unseen anchors. Keep source labels and original-script evidence.

**Milestone D — breadth:** incremental, checkpointed offline precomputation for all eligible lexeme/lemma anchors and contextual occurrence variants, with bounded Cloudflare assets and fallback/partial states. Add *only* small relevant WordNet/Wikidata imports when they measurably add novel connections beyond existing graph; defer costly ontologies.

**Milestone E — beautiful exploration and full acceptance:** extend WordInspector into fast mobile exploration with categories Text, Language, World/Physical, Patterns/Hypotheses; path proof drawer, alternate routes, clickable intermediate concept nodes, bookmarked/history/navigation, exploratory tail and MCP parity. Do not delay first prototype for visual polish. Preserve existing R8–R11 compatibility, appropriate rights and source attribution, independently selected holdout labels and Worker CPU/read budgets.

**Earlier deliverable beats comprehensive infrastructure:** do not demand D2–D7 all finish before one card appears. The first working direct result and first multihop proof are separate explicit acceptance gates.

## 6. Make every remaining task a low-token, high-first-pass-success coding prompt

Astra must do the *hard design* **in the task text itself**. For each small task, include:

- **ID, state, single feature/outcome, prototype/live milestone.**
- **Recommended model + minimum viable alternative + reasoning effort**, with escalation criterion.
- **Exact existing files and function names**, from *current local code* (not guesses based on old GitHub branch). New files clearly marked. Prefer 1–4 source/test files per task unless justified.
- **Frozen source/data/type contract**, including inputs, outputs, edge status, edition/source/coverage fields and actual legacy API compatibility; avoid inventing new aliases.
- **Precise algorithm/pseudocode and integration steps** (bounded loops, normalization, indexes, scoring, data/memory/CPU constraints), not an invitation to invent a design.
- **Tests to add or run**; exact commands known in repository; predicted result/negative fixture and required pass/fail rule; no fake pass on skipped prerequisites.
- **Edge cases and must-not-do**: no hardcoded example branches, no token/verse conflation, no silent fallback to huge books, no corpus overwrite, no restrictions bypass.
- **Dependency/parallel group & exclusive files**, expected artifact path, rollback/preview-revert method.
- **Completion checklist:** targeted tests; typecheck if touched; release asset integrity if touched; UI/MCP parity for user-facing work; push commit with SHA; live test link if deployed; short ChatGPT report; update task queue and synchronize backup.
- **Stop condition**, max allowed wandering (e.g. inspect only referenced files; 2 unsuccessful repair attempts then produce diagnostic and escalate). No multi-hour open-ended repetitive test loops.
- **Transfer capsule**: at most 8–12 brief lines describing functions changed, current contract, known exact failures, already-run tests and next dependencies. Next agent reads this, not a giant transcript.

One task = a complete small **working implementation**, not a sprawling architecture revision or a half-built façade. Choose vertical task boundaries that make self-contained verifiable changes; avoid microtasks that require repeated agent startup and handoff overhead.

**Mandatory evidence discipline:** no spurious etymology from consonant overlap, no semantic synonym from English gloss alone, no authority from a possible allusion, and no conflation of Rev 1:20 / Rev 4:5. Experimental candidate results can be surfaced with accurate labels. The user explicitly prefers useful imperfect research leads over an over-filtered empty graph.

## 7. Model assessment — current real availability, not invented labels or prices

Astra must **inspect current model options** actually available in the user's VS Code Codex and Antigravity environment and consult current *official* capability/price/usage documentation where accessible. Do not treat old model marketing names, account entitlements or benchmark rumors as facts.

Evaluate Astra, Sol, Terra, Luna, Gemini Hydrogen and any relevant currently available choices by:
- Scoped coding reliability and how often a successful first pass needs repair.
- Ability to follow strict algorithms/data contracts and implement Node/TS/Cloudflare/Supabase integration.
- Tool-call behavior/latency, code edit accuracy, context size, reasoning settings, relative usage/credit cost.
- Strength at code review, tests, source-license judgments, cross-module debugging.
- Best ROI measured as **successful accepted task per unit of quota**, not cheapest token in isolation.

Produce a compact **model assignment matrix**, not a long market survey. Default lowest capable model + modest thinking on small deterministic tasks; Sol/Hydrogen on multi-module integration; Astra only for cross-system difficult reasoning, ontology/syntax ambiguity or recurrent failures. Validate model names/availability locally; use a nonessential 10–15 minute calibration task **only if** evidence is insufficient (avoid spending user quota on redundant model benchmarks). Do not buy paid services.

For routine tasks prepare a one-message launch prompt:

> In `C:\Projects\BibleResearch-r10`, follow AGENTS.md; execute task [ID] in the latest local TASKS.md. Its contract, exact files and tests are authoritative. Work only in those files; no new architecture or repeated broad research. Implement complete feature, run named targeted tests, publish commit to current feature branch, update TASKS.md + identical R12TASKS.md, and write the concise ChatGPT checkpoint. Stop and report exact blocker if a required dependency is missing.

## 8. Parallelism with genuinely less cost

Default to **one implementing agent**. At most two concurrently when they have frozen shared contracts, disjoint files and output directories, no predecessor relationship, and a simple integration merge. Only one owner edits TASKS.md/R12TASKS.md; the second sends a small completion handoff to the owner.

Potential: independently test scene/lexical extractors while UI adapter works on frozen mock JSON; form compiler while MCP response client is implemented; WordNet importer while structural compiler uses separate input/output roots. **Never** parallelize two agents on multihop-search.ts, path-ranker.ts, shared types, generated manifests or Worker handlers in the same branch simultaneously. Separate worktrees only if they reduce conflict; don't create needless branches to manage a simple task.

## 9. Always push GitHub; live testing now authorized — with precise safety boundaries

The user explicitly wants **every accepted task committed and pushed to GitHub**, and has authorized **test deployment** because the product's public launch has not happened. This supersedes the old blanket R12 "no push/deploy" execution rule; update that rule in local TASKS.md.

**Important verified fact:** the currently connected GitHub repository `kingdomfishers/BibleResearch` is **PUBLIC** as of this planning session, despite the user's statement that the project is not publicly launched. **Never assume the repository itself is private**. Ask for/arrange private repo access policy separately if needed; do not push keys, secrets, personal notes, confidential docs, restricted corpus data, local absolute credentials, .env files or large generated data. Inspect staged files before EVERY push. A workers.dev preview URL is not protected merely because unadvertised. Use Cloudflare Access/auth or a verified already-private staging hostname if confidentiality is required; otherwise label it public test deployment, and keep responses free of private data.

**Git operations:** preserve working tree and existing user branches, make narrow commits with task IDs, no force push, no blind main merge, no history rewrite. Create/push a correctly tracked remote feature branch if the local branch is not on GitHub. Prefer one clearly named R12 integration branch; preserve existing protected branches. If branch policy requires PR, create it rather than bypass it. On a testable checkpoint push source and necessary eligible public static assets; do not push generated licensed/private corpora or release keys.

**Live test behavior:** use an existing Cloudflare test Worker/site when possible. May deploy non-destructive candidate Worker/static release for user testing and MCP connectivity, with release selection/rollback. Do not change production database schemas, purge protected assets, run destructive migrations or disable access control. A live test UI should show real source-backed evidence, not unlabelled fake demo records. Verify deployed endpoint response, version/commit and source/provenance, click flow on desktop/mobile, and MCP gateway parity. If deploy makes the service reachable on an open public URL, declare it explicitly and ensure its data are publishable.

**Task completion:** each accepted task has push SHA; test URL and response check if applicable; rollback information; and concise report for user.

## 10. After every task, make ChatGPT independent verification possible

Create and maintain `research/r12/CHATGPT_CHECKPOINT.md` **in the current implementation branch**, updated on each accepted task and pushed with the code. This is a *short, append-by-task evidence ledger*, not a multi-thousand-line transcript. Include:
- Task ID, status DONE/PARTIAL/BLOCKED, local workspace commit SHA, GitHub branch and URL, deployment release/preview URL.
- Exact change summary, source/data release hash, tests with pass/fail count, known limitations.
- A reproducible public/demo-safe **MCP tool invocation** (actual existing name + input JSON) and/or API request of small size, with expected **real** response fields and where to find actual proof IDs.
- An observed MCP result if one can be called/tested from the active client; clearly label a sample schema if it could not. Do not invent a response or claim a tool is live because its code exists.
- A 5–15 line ready-to-paste block titled **"Copy into ChatGPT for independent check"**, with current branch/commit/release, tool name or endpoint, specific anchor(s) and questions; request comparison of UI evidence with MCP evidence and source verses.
- One next-task ID and precise dependency.

If the task touches UI/MCP, run a **real** representative Hebrew/Greek word query through live staging Worker and, if the configured MCP is reachable, through the actual MCP tool. Include response status and cited evidence IDs or specific failure. Never silently substitute a mocked response. If MCP deployment or connector refresh is not available, record BLOCKED for parity while core code can be accepted as an intermediate milestone; provide an exact follow-up action.

To keep tokens low: agents should **not paste full logs**. The durable GitHub checkpoint holds the reproducible evidence, and the final agent report should be <=12 concise lines plus direct URL.

## 11. Development quality: not over-engineered, not broken-first

**Early prototype gate** (fast targeted checks): word ID fidelity, Hebrew/Greek direct neighbor correctness, no fabricated evidence, basic selection/404 behavior, UI/MCP response parity where available, affordable local bundle size. Run existing regression suites relevant to touched files, TypeScript check and build when UI/types change.

**Full release gate** (later): original R8/R9/R11 regressions, all retained 157 fixture IDs with honest pass/fail/not-run states, eight original R12 mandatory cases, independent holdout, provenance/licenses, 0 unsupported authoritative claims, deterministic offline assets, cold/warm Worker active CPU/read/decode budgets, navigable UI/MCP. Do not run full-corpus CPU stress after every tiny edit.

**No test shortcuts:** missing assets/prerequisites cannot silently report pass, and hardcoded benchmark examples do not count as algorithmic discovery. Candidate source claims must remain candidate; negative grammatical statements remain negated. Preserve old releases and source rights.

**After 2 failed fixes:** diagnose root cause with a narrow reproduction. If architectural, escalate model once; otherwise file a precise blocker and keep the next eligible independent task moving. Never burn a full quota window repeating broad builds without new evidence.

## 12. Final output for this Astra session

1. Updated authoritative local `TASKS.md` containing optimized R12 execution tasks; `R12TASKS.md` exact full-file backup, hashes verified.
2. Task migration map, accurate D1.1–D1.3 completion evidence, shortest dependency/parallel graph, model+effort matrix.
3. A first **implemented** end-to-end milestone on real project data (at minimum the earliest feasible direct-relationship UI+MCP slice), with targeted tests, new commit and GitHub push. If safe staging deploy feasible, actual preview URL and observed health/MCP results.
4. Updated short ChatGPT checkpoint in repository with exact copyable independent-research test cases.
5. Concise final report: changed files, verified status, URL, commit SHA, tests, known blocker, first next low-tier task. **Do not stop with only a design document if implementation can proceed.**

**Project is not yet launched publicly, but the GitHub repository is publicly visible. Test live carefully, without assuming privacy from obscurity.**
