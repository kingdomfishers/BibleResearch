# BibleResearch — independent live MCP compatibility retest & ranking improvement plan

**Observed:** 2026-11-22 (Europe/Zurich). **Branch:** `feat/r12-qa-fixes`. **Scope:** read-only live testing; repository artifacts added; **no engine weights, Worker, Supabase data, or deployments modified**.

**Read first:** [Machine-readable 239-case evaluation](COMPATIBILITY_EVALUATION_239.json) and [12 full top-25 query batches](.). Compare with [frozen expectations](../R12_EXPECTED_CONNECTIONS_180_PLUS.json), the [2026-11-19 live discovery baseline](../live_mcp_retest_2026-11-19_r12_discovery_2/INDEPENDENT_LIVE_QUALITY_REPORT_2026-11-19.md), and [four-round optimized LOCAL report](../R12_PARALLEL_OPTIMIZATION.md).

## 1. Critical interpretation boundary

This is **not the original discovery RPC benchmark run on the newly optimized code**. The 239 frozen cases call `discover_biblical_connections_v2({query, limit:25, max_hops:5, mode})`. The currently connected BibleResearch MCP instead exposes `get_Passage` / `get_Word` (plus other research tools), which do not accept the old `mode` or `max_hops` inputs. The original `mode:"bridge"` could not be expressed for **40 positive cases**. Their failures must **not** be interpreted as failures of the original bridge-mode implementation.

We ran all **190 distinct query strings/payloads** represented by the 239 frozen cases, deduplicated identically to the historic source's unique-query protocol:
- Verse/passage-shaped input: `get_Passage({passage:q, depth:25, word_depth:0, etymology:0, realworld:0})`.
- Word, Strong's or concept input: `get_Word({word:q, connections:25, etymology:0, realworld:0})`.
- Stored each returned top-25 item's ordinal, ID, title, relation, epistemic class, tier, target, biblical references and shortened explanation/witness. Three calls were concurrent per batch; request timings are **connector wall-clock** and must not be treated as Worker CPU timings.
- Evaluated each frozen expectation by **exact normalized Strong's target ID or target verse reference** in an individual card's target/ID/title/references. Broad description-only expectations were **unassessable**, not counted as missing targets. A separate soft alias screen is recorded for debugging but is prone to false positives (e.g. `dam` substring inside `adam`). A card mentioning a target does **not** establish the claimed theological, causal, lexical, or authorial connection.
- No human judgment of every evidence item was performed. Especially for negative controls, the absence of a string does not establish safety and a present word is not proof of a false assertion.

**Do not compare `110/186` below to `136/215` (old live discover), or to `169/215` (optimized local discover), as a regression or improvement rate.** Different interfaces, modes, evidence cards, and denominators make those comparisons invalid. Their ranking-family mix is an investigative clue, not an A/B statistic.

## 2. Live measured outcomes

| Live compatible 7-tool benchmark | Result |
|---|---:|
| Frozen benchmark rows | 239 = 215 positive + 24 negative |
| Distinct queries executed | **190/190 successful** |
| Positive expectations with exact target ID/reference | **186/215** |
| Expected target at prescribed top-K | **110/186 = 59.1%** (110/215 across all positives, with 29 unassessable) |
| Expected target visible only after K in top 25 | **27** |
| Expected target **absent from top 25 among assessable cases** | **49/186** |
| Positive cases with no machine-checkable target (not a failure) | **29** |
| Positive cases with no structured target hit (including 29 unassessable) | **78/215** |
| Positive targets in top 5 | **42** |
| Loose alias hits at K (unsafe scoring shortcut) | 150; **not an accuracy metric** |
| Source + expected target reference co-present in a top-K card | 68; **not evidence-verified precision** |
| Connector round-trip median / P95 / max | 2,859 / 6,778 / 11,954 ms; not backend latency |
| Returned error/non-ok response | **0/190** |

**Category breakdown, exact targets only** (note denominator for the four real-world groups is small):

| Category | At K / mechanically assessable | After K | Absent in top 25 | Unassessable |
|---|---:|---:|---:|---:|
| Linguistic form/wordplay | 5/5 | 0 | 0 | 0 |
| Linguistic lexical links | 5/22 | 6 | 11 | 1 |
| Linguistic polysemy | 1/3 | 0 | 2 | 2 |
| Linguistic LXX/translation | 21/22 | 0 | 1 | 0 |
| Direct intertext | 41/55 | 10 | 4 | 0 |
| Narrative chronology | 3/8 | 1 | 4 | 0 |
| Narrative patterns | 26/54 | 8 | 20 | 0 |
| Genealogy | 2/3 | 0 | 1 | 0 |
| Physical/material | 4/8 | 1 | 3 | 6 |
| Physical part/whole | 1/2 | 1 | 0 | 2 |
| Physical process | 0/2 | 0 | 2 | 10 |
| Physical property | 1/2 | 0 | 1 | 8 |

**Top-five composition across 190 unique queries, 950 ranked slots:**

| Candidate family | Slots | Share |
|---|---:|---:|
| `r11:lxx` | 318 | 33.5% |
| `r11:gram` | 276 | 29.1% |
| `r11:cluster` | 163 | 17.2% |
| All `r10:*` | 76 | 8.0% |
| `r12:path` | 43 | 4.5% |
| `r11:lex` | 33 | 3.5% |
| `r11:xref` | 28 | 2.9% |
| `r12:prop` | 7 | 0.7% |
| `r11:colloc` | 6 | 0.6% |

`r11:lxx` + `r11:gram` = **594/950, 62.5%**; including generic `r11:cluster` reaches **757/950, 79.7%**. This is excessive *for broad exploratory discovery*, although grammar and LXX can be exactly right for lexical research intents. The interface needs **intent-sensitive** result ranking rather than universally demoting these evidence types.

The prior **optimized offline** discovery ranking showed `r11:gram` + `r11:lxx` = **254/950 (26.7%)** and `r11:xref` = **421/950 (44.3%)**, versus **594/950** and **28/950** in this 7-tool compatibility read. Not comparable interfaces: first determine **which pipeline each MCP tool actually invokes, whether local optimizations are deployed, and whether old broad discovery controls are missing from the new wrapper**. The optimized branch is **93 commits ahead** of documented deployed corpus source commit `d9940058651c83befa168a2f31e60fca0c691414` at the time of our check; do **not** infer current Worker code from GitHub alone.

## 3. Concrete successful and missed research links

| Frozen case | Expected connection | Current 7-tool target rank | Assessment |
|---|---|---:|---|
| L001 `H0120` | Adam → adamah (ground), Genesis 2:7 | **#1**, K15 | Good explicit literary wordplay; stable anchor |
| L002 `H0120` | Adam → dam (blood), Gen 9:5–6 | **#8**, K25 | Useful exploratory *spelling* connection, correctly labeled `orthographic_similarity_only`; not demonstrated historical etymology |
| S006 `Exodus 14:30` | Red Sea → Paul's baptism comparison (1 Cor 10:1–2) | **#1**, K15 | Strong passage-aware authorial parallel |
| L022 `H3899` | Bread → Greek G0740 | **#1**, K12 | External-world link appears; check actual property/witness before asserting mechanism |
| D001 `Genesis 1:1` | John 1:1 creation/Word correspondence | **#14**, K10 | Target retrieved but displaced; plausible rerank win |
| S009 `2 Kings 2:14` | 2 Kings 2:8 shared Elijah/Elisha crossing scene | **#17**, K12 | Target present, local grammatical and LXX fragments rank higher |
| L027 `G3088` | G5459 lamp/light-bearing (2 Pet 1:19) | **#18**, K10 | Endpoint witness present but late; avoid overclaiming metaphor |
| S001 `Exodus 12:15` | Exodus 12 departure → Exodus 14 sea crossing | **absent <=25**, K25 | Event-span retrieval/scene linking defect (or current interface omission) |
| D042 `Isaiah 61:1` | Luke 4:18 | **absent <=25**, K10 | Intertext candidate generation/wrapper problem; verify full source spans |
| D050 `Zechariah 12:10` | John 19:37 | **absent <=25**, K10 | Direct quotation/citation graph should beat generic vocabulary associations |
| D003 `Genesis 1:26` | Genesis 9:6 image-of-God and blood | **absent <=25**, K10 | Thematic passage correspondence needs event/attribute support |
| S028 `Joshua 2:18` | Matthew 1:5 Rahab genealogy | **absent <=25**, K20 | Genealogy graph/verse anchor recall gap |
| W014 `H5178` and W024 `vine` | physical/bridge relations | **no strict hit** | **Not interpretable as legacy bridge-mode failures**; `mode` was inaccessible |

**Negative/anti-overclaim spot checks:** Previously false Hagar→ostrich (N001), eye→angel (N002), logos→kidney (N003), covenant→wheel (N004) do **not** reappear as targets in the first 25 cards of their word queries. The `three days resurrection` query (N009) no longer puts the spurious Genesis 5:23 365-year event in its first 10, but it mostly presents generic `day` grammar cards: *no absurd numerical connection* does not equal *good resurrection discovery*. Other negative cases remain **unadjudicated**; do not report a blanket 24/24 PASS from this method.

**Qualitative problems still worth tracing:**
1. Query `Genesis 1:1` yields general LXX and grammatical records instead of prioritizing John 1; `2 Kings 2:14` likewise buries its immediate scene witness. These are **ranking/intent** issues where the target is in top 25.
2. Repeated `Temple & Sanctuary Architecture` cluster cards for unrelated passages/concepts suggest a **category-label or cluster-seeding false-positive/hub** problem; examine source data before changing category names or simply tuning scores.
3. Several evidence cards use a real biblical verse but claim a relation that may not hold at the *selected sense*, *source edition*, or *narrative event*. A verified token identity is necessary but not sufficient for a meaningful inference. Preserve evidence-layer distinctions and independent witness requirements.
4. `r12:path` can surface a real multi-hop adjacency without directly establishing its endpoint connection. Keep `DIRECT_ENDPOINT_WITNESS`, `COHERENT_MULTIHOP_LEAD`, and `EXPLORATORY_STEP_CHAIN` separate and penalize non-compositional paths.

## 4. Code-backed diagnosis: why universal scalar tuning will underperform

The authoritative branch currently contains the following mechanisms in `src/relationships/r10-discovery.ts`:
- Evidence tier bases: **950, 860, 760, 650, 520, 380, 240, 140** (tiers 1–8).
- `buildXrefRecord`: base scores **835** (reciprocal cross-testament), **785** (reciprocal), **750** (one-way cross-testament), **700** (one-way other); bounded cap **915/875**, with evidence typed `editorial_cross_reference`. These are not proofs of ancient quotation.
- Passage-only query penalty for non-source grammar **195**, for routine LXX **190**, and profile background **190**; yet grammar/LXX remain very common in current MCP top-five output.
- Query mode `bridge` deliberately boosts source-attested `r12:prop` and `r11:xref` **+130**, witnessed non-internal LXX **+50**, cross-testament `r12:path` **+45**. **These boosts cannot be exercised from the compatibility wrapper.**
- Candidate diversification uses family grace and then per-family penalties (typically **55**/extra record; passage seed xrefs **25**; selected multihops **30**), with passage xref grace **5**. It is a helpful baseline but cannot guarantee semantic diversity or source-specificity.
- `src/relationships/path-ranker.ts` has intermediate-node hub penalty default **28** for function words, degree threshold **250**, weight **8**. Its path coherence and evidence status should remain authoritative; do not reimplement a second ranker.
- Current sorting first groups `all_concepts`, `meaningful_subset`, `background`, then sorts by absolute heuristic score. A candidate with genuine direct passage relevance can be lost if it was **never generated or surfaced**, and generic scoring across disconnected candidate families is hard to calibrate.

**Likely mechanism:** The lower-level `get_Word` / `get_Passage` discovery summaries appear to use different coverage, budgets, intent, or version than the locally optimized full `discover_biblical_connections_v2`. Establish pipeline/version parity **before** attributing the current percentages to R12 final local weights.

## 5. Ordered improvement program

### P0 — Establish a genuinely comparable baseline (highest priority)

1. Trace `get_Word` / `get_Passage` → underlying connection fetch/ranking path → corpus Worker → release, commit, `score_version`, `asset_sha256`, mode and `max_hops`. Check against `src/relationships/r10-discovery.ts`, `src/relationships/path-ranker.ts`, and `supabase/functions/bible-mcp/discovery-v2-tools.ts`. **Do not deploy or refactor before establishing routing and source parity.**
2. Run the **original 239-case frozen suite** against the original `discover_biblical_connections_v2` RPC on the *latest actually deployed build* (or use a repeatable, explicitly versioned Actions/CI direct-runner), preserving `mode`, `max_hops`, `limit` and original scorer semantics; save all 190 complete unique responses and per-case ledger. Keep separate from this compatibility report.
3. Confirm whether local four-round weights producing **169/215** strict target hits were ever deployed or incorporated into the seven-tool summaries; if not, assess release/deploy route before another tuning cycle.
4. Instrument each candidate's **source**, **generation stage**, **pre-score**, **query coverage**, **sense match**, **direct endpoint evidence**, **final rerank**, **diversity penalty**, **evidence ID**, **version**. Do not surface private implementation or restricted corpus fields to untrusted clients; diagnostics can be gated/read-only.
5. Apply word occurrence/cross-corpus identity guards (Zechariah 4:2 canary, Greek and Psalm shifted verses) before relying on the grammar/scene features. This is a regression guard, **not a request to retune word IDs**.

**Exit:** new results are exactly comparable to earlier direct discovery baselines; one authoritative ranking implementation; release manifest pinned. First distinguish **27 late-but-retrievable** cases (rerank target) from **49 missing among assessable** (retrieval/asset target).

### P1 — Retrieval coverage, intent-aware ranking and source-grounded diversity

**A. Explicit query-intent router (lightweight, deterministic first; learn later):**
- `passage_intertext`: prioritize directly joined source/target citations, authorial quotation/allusion, source-local shared rare lemmas, event continuity, scene correspondence; only then generic LXX/grammar.
- `lexical`: prioritize tested morphology, lexical relation, sense disambiguation and ancient translation; grammar/LXX can occupy top positions if grounded.
- `multi_concept`: require a candidate to cover all governing concepts (or display precisely which are unsupported), rather than aggregate overlapping terms across disconnected verses.
- `physical_bridge`: prioritize independently attested physical concepts, part/whole/material properties with **sense and provenance**; never infer that a biblical metaphor asserted physical identity.
- `open_discovery`: use novelty and mechanism diversification only after relevance, evidence and epistemic constraints pass.

**B. Multi-stage candidate generation:** merge separate source-anchored recall streams: (1) direct quotations + editorial xrefs, (2) pericope/event/chronology, (3) lexical/syntactic/LXX, (4) structural scene analogies, (5) property/physical-world bridges, (6) coherent 1–3-hop graph paths. Use **reciprocal rank fusion (RRF)** initially to join heterogeneous streams without comparing incompatible raw source scores, then a unified reranker. Preserve all stream IDs and evidence; when missing targets are already in another index (e.g. Isaiah 61 → Luke 4), fix candidate generation first.

**C. Evidence-level reranker:** for each `(query, candidate)`, compute separate features:
- `anchor_coverage`: candidate contains queried passage or genuine surrounding pericope vs merely matching a frequent lemma.
- `target_pairing`: explicit reference to source AND proposed related target in one inspectable evidence set.
- `mechanism_fit`: direct citation, independently witnessed lexical wordplay, matching narrative roles, cross-language translation, or only contextual proximity.
- `rare_feature_overlap`: IDF of shared content-bearing Hebrew/Greek lemmas, with homograph sense, grammar and version agreement.
- `independent_witnesses`: distinct canonical passages/source traditions, not mirrored editions and not multiple correlated syntax feature encodings.
- `path_coherence_K`, `endpoint_support`, `hub_penalty`, `path_length`, `contradiction_or_wrong_sense`, `explanation_completeness`.
- `novelty` should be a **low-weight tie-breaker**, not a way to promote speculative chains above true witnesses.

**D. Source-specific diversity:** use evidence-aware **MMR/xQuAD** or per-family exposure controls *after* reranking. Deduplicate `r11:lxx` and `r11:lex` cards expressing the same translation edge and symmetric grammar records. Where available, favor a mixture of direct witness, narrative event, lexical evidence, structural analogy and physical bridge; do not manufacture an example from a missing/unsupported family simply to fill a quota.

### P1 weight experiments (STARTING HYPOTHESES, not deployed or validated)

Rather than editing the tier bases globally, run small isolated ablations on existing scoring units. Work from branch code and save every change's `score_components` diff. **Only accept tested changes, rollback unsuccessful ones.**

| Experiment | Candidate change | Intended result / guard |
|---|---|---|
| E1 passage relevance | On passage-seeded *intertext* intent, increase **direct source+target witness / cross-book event +120 to +200** compared with neutral background (or normalized feature equivalent). | Promote D001 @14 and S009 @17 into K without promoting unrelated xrefs. Quote-vs-editorial provenance remains distinct. |
| E2 generic evidence crowding | For passage queries **without explicit source/local witness**, trial grammar/LXX demotion **–230 to –300** instead of currently ≈–190/195; **do not demote lexical-intent queries**. | Reduce 62.5% grammar+LXX saturation; preserve verified grammatical interpretations. |
| E3 weak cluster labels | Suppress/demote generic `r11:cluster` **–180 to –280** when neither rare topic-specific tokens nor exact seed passage support its category; preserve supported clusters. | Reduce irrelevant “Temple & Sanctuary” entries. Inspect index labeling first. |
| E4 candidate diversity | Compare existing repeated-family penalties **55** with **70 / 90** *only after evidence-source grouping and duplicate collapse*. | First 5 show independent valuable mechanisms; avoid lowering precision. |
| E5 multi-concept completeness | Trial **+130 to +220** bonus for candidates with *all required query concepts at one verifiable source/event*; **hard reject** claims reusing one token as two distinct witnesses. | Fix “three days resurrection” ranking; do not read 365 years as three days. |
| E6 graph coherence | Try intermediate degree threshold **250 → 150** and hub weight **8 → 12** on the development set, then check both easy and surprising positive holdout paths. | Prune cheap high-degree grammar chains while retaining rare genuine connections. Not a universal improvement. |
| E7 cited intertext | Add independent rare-lemma, direct quotation and verified source-span features; rerank editor-provided links by witness evidence rather than simply raising all cross-reference scores. | Retrieve Isaiah 61→Luke 4, Zechariah 12→John 19. **Must first see those targets generated**. |
| E8 mode parity | Make new MCP tool explicit about `discover`/`bridge` or reuse the correct named backend mode internally; compare same 40 bridge cases through equal settings. | Restore appropriate physical/process recall; do not interpret present bridge results as an A/B. |

The numbers are **candidate experiment bands**, not empirically optimized production weights. Keep `TIER_BASE_SCORE` evidence confidence separate from user-oriented discovery relevance: a literal local grammatical relation may be *more certain* but *less relevant* than a documented long-range quotation. **High epistemic confidence must not automatically mean high query usefulness.** Keep hard negative gates before scoring to block fabricated evidence or disjoint-event composition.

### P2 — Add algorithms to find genuinely surprising, defensible patterns

1. **Typed narrative scene matching**: normalize pericope scenes to `agent → action → patient/object → instrument → location → result → temporal order`, using verified Macula clause roles and named entities. Match roles across books with weighted bipartite assignment / constrained graph edit distance, IDF-weighted rare attributes, and chronology. Require ≥2 *independent feature families* before asserting a scene pattern; present original-language witnesses for each mapped role. Test Ezekiel 1 ↔ Revelation 4, Zechariah 4 ↔ Revelation 11, Daniel 7 ↔ Revelation 13, Joshua 3 ↔ Exodus 14. Avoid correlating duplicated syntax features as independent confirmation.
2. **Quote/allusion recognition with LXX anchoring**: precompute long-phrase and weighted rare-lemma alignments between NT citations and LXX/MT, with biblical book and verse-span windows. Separate explicit formulaic quotation, distinctive allusion, modern editorial cross-reference, thematic similarity, and interpretive typology. Never promote a match to “historical dependence” automatically.
3. **Constrained evidence graph search**: bounded beam search (prefer 1–3 hops), type-specific edge costs, event/sense compatibility, source-independent proof groups, intermediate hub penalty and endpoint witness requirements. Optimize path coherence `K` and penalize cross-event paths where each edge has genuine but unrelated verses; preserve honest exploratory paths at lower priority.
4. **Contrastive negative evidence**: pair biblical counterexamples with candidate broad assertions, e.g. `ruach` wind vs spirit sense, lamp vs lampstand, seed botanical vs descendants, alleged universal theological symbolism. Ask “what would falsify this claim?” at the explanation layer. Counterevidence reduces certainty or scopes the claim; it does not automatically erase a useful textual parallel.
5. **Offline learning-to-rank, then deterministic runtime**: once ~300–500 independently reviewed *(query, relevant/nonrelevant candidate)* labels exist, fit a simple constrained pairwise logistic model or LambdaMART/LightGBM feature ranker offline; compile only small feature weights/trees into Workers. Split **by books/query families and scene groups**, not random rows from repeated queries, to prevent leakage. Human-review the most informative disagreements; do not use self-generated labels as sole gold standard. This is **after** deterministic candidate recall and source correctness are sound.

## 6. Verification and acceptance gates for every iteration

Use `scripts/eval-r12-optimization.mjs` for reproducible **direct discover** evaluations, plus a new read-only seven-tool surface parity check. Re-run the frozen 239 cases only at milestones, not after every small change; use small high-signal batches and reserve a hidden/frozen holdout and new non-overlapping scenes. Maintain precise denominator names.

**Metrics to track independently:** exact target@K (machine recall), paired source/target witness@K, first relevant rank/MRR, nDCG@5/10 on human-reviewed judgments, semantic precision@5, unsupported-claim rate, wrong-sense/identity rate, provenance validity, direct quotation vs editorial claim classification, path incoherence, novel *verified* discoveries, family diversity, missing assets, latency P50/P95, per-call CPU, asset reads/bytes, first-pass HTTP errors. Log query intent and baseline/version for every row.

**Suggested gates to evaluate, NOT promises:** direct intertext ≥45/55 and paired evidence improvement over prior local 41/55 paired; narrative pattern ≥37/54 vs offline 33/54; 24 negative controls manually verified (not just substring checks); 0 verified identity/provenance errors; improved first-five human precision; no significant performance/asset-budget regression (current local cap 45 asset reads). Use performance/precision Pareto tradeoff rather than claiming one scalar is universally optimal.

**Required ablation matrix:** baseline; +intent routing; +retrieval stream fusion; +passage witness score; +sensed/typed structural scene features; +family diversification; +hub/path penalty; combined. For each report `gain@K`, `loss@K`, new coverage, specific regression examples, and confidence intervals across **unique queries** (rather than treating 239 correlated case rows as independent).

## 7. Immediate agent execution order (cost-aware)

1. **Low-tier agent, read-only:** inspect this report, existing `TASKS.md` and `R12_PARALLEL_OPTIMIZATION.md`, trace the *live* seven-tool ranking codepath and deployed source/asset version. Report parity, whether the **169/215 local changes are actually live**, and how to execute the exact old RPC with identical parameters. No code editing yet.
2. **Low-tier agent, isolated:** run the exact old-RPC benchmark against the confirmed deployed version; produce a new machine-readable comparator including top-25 IDs, score components and evidence-version metadata. Keep existing frozen expectations unchanged.
3. **Low-tier parallel subagents:** split 27 late cases into a **rerank** queue; 49 absent assessable targets into a **retrieval/index** queue; separately analyze 29 **benchmark-schema** unassessable cases (annotate evidence IDs and canonical targets, without changing frozen definitions). Inspect important negative control evidence manually/with a higher-tier reviewer when ambiguous.
4. **One orchestrator, minimal tokens:** prioritize the smallest reversible correction, delegate E1–E8 individual bounded probes, hold back the frozen holdout until integrated milestone, and only escalate genuine algorithm/interpretation conflicts to a high-tier reasoning model. No blind repeated full-suite testing.
5. After verified improvements, pin deployment commit/asset hash, rerun exact CI and sample connected-tool parity, then update this report with **actually observed** before/after metrics. Do not overwrite this immutable 2026-11-22 observation.

## Evidence ledger location

- [Raw complete top-25 results: BATCH_01–12](.): all 190 query observations, preserved ordering, connector statuses and requested modes.
- [Machine-readable 239-case compatibility ledger](COMPATIBILITY_EVALUATION_239.json): every expectation, K, exact match rank, category and top-3 cards.
- [Frozen source (unchanged)](../R12_EXPECTED_CONNECTIONS_180_PLUS.json).
- [Previous direct live R12 evaluation](../live_mcp_retest_2026-11-19_r12_discovery_2/INDEPENDENT_LIVE_QUALITY_REPORT_2026-11-19.md).
- [Previous offline Round-4 optimization claims and resource budget](../R12_PARALLEL_OPTIMIZATION.md).

**Bottom line:** Before adding more graph edges or tweaking global tier weights, prove **source/version parity** and restore **intent-aware, source-paired ranking** in the connected research interface. Then address **late but retrieved** targets with reranking and **truly missing** targets with candidate generation. Introduce scene-role alignment, quote detection and independent evidence graphs to improve surprising discoveries without inflating false connections.
