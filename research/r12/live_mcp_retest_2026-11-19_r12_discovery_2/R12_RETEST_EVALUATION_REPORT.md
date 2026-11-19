# BibleResearch R12 — Independent Post-Improvement Discovery Evaluation

**Date:** 2026-11-19 (Europe/Zurich)  
**Evaluator:** ChatGPT, using actual connected `@BibleResearch` MCP tools, with read-only Supabase health/function/log inspection and GitHub-sourced frozen cases.  
**Status:** **COMPLETE 239-case execution and retrieval comparison; selective evidence verification, not an exhaustive semantic gold-standard adjudication.**  
**Deployment tested:** corpus `r12-discovery-2`, `r12-ranker-v2`, Worker version `cce819e9-60d4-4e17-bb01-ed138af9a9a3`, source commit `d9940058651c83befa168a2f31e60fca0c691414`, MCP `1.8.0` / Supabase `bible-mcp` v44.  
**Comparison baseline:** `r12-discovery-1`, Supabase MCP v43, [2026-11-19 original 239-case retest](../live_mcp_retest_2026-11-19/R12_MCP_RETEST_REPORT.md) and [239-case diagnosis](../R12_BENCHMARK_DIAGNOSIS.md).  
**Frozen expectations:** [R12_EXPECTED_CONNECTIONS_180_PLUS.json](../R12_EXPECTED_CONNECTIONS_180_PLUS.json) (215 positive expectations, 24 negative controls; unchanged).

## Executive verdict

**Meaningful measurable progress, not completion.** The new engine is materially better at surfacing exact expected biblical target words and passages, especially cross-book intertexts. It removes the four previously confirmed incoherent multihop endpoint paths and improves concept resolution (notably `yeast`). Its source-evidence classifications and physical-world provenance also improved in inspected samples.

However, a **live HTTP 503 regression** appeared under this complete serial workload; ranking is still disproportionately filled by grammatical/LXX dictionary facts rather than illuminating discovery trails; many substantive narrative links are absent or too low; multi-term queries can still ignore the user's governing concept; and some source-listed cross-references are topically weak. The algorithm remains a useful research assistant, not yet a reliably high-precision discovery engine.

**Critical interpretation rule:** benchmark target-word/verse matches are **retrieval screens**, not confirmed semantic PASS results. An expected term or verse appearing in a result does not establish that the result explains the expected relationship. The original curated expectations themselves are proposed research checks and must be independently checked before being considered gold truth.

## 1. Method and reproducibility

- Invoked `discover_biblical_connections_v2` using **the exact frozen benchmark arguments**, including mode, `limit:25`, and `max_hops:5`.
- Ran every distinct argument payload **serially**, through the connected MCP tool, without substituting simulated responses or a different provider. The 239 cases collapse into **190 distinct query argument payloads**; one live response is deterministically associated with every case referencing the same payload.
- Captured the ordered top-25 connection IDs, titles, classes, scores, biblical references, original-language IDs, path-coherence metadata, and per-request latency. Individual complete top-25 records are in the numbered [batch files](QUERY_MANIFEST.json), with a compact one-row-per-case [239-case comparison matrix](R12_MCP_RETEST_ALL_239.json).
- Preserved initial request failures **even though subsequent retries recovered them**. Retry payloads and results are separate in [RETRY_503_Q136_Q142.json](RETRY_503_Q136_Q142.json).
- Completed **12** independent `get_connection_evidence_v1` spot checks, saved in [EVIDENCE_SPOT_CHECKS.json](EVIDENCE_SPOT_CHECKS.json), plus four additional read-only edge-case evidence inspections (Exodus 12:15→Galatians 5:12; Genesis 1:1→John 1:1; Exodus 12:15→Exodus 13:18; 2 Kings 2:14→2 Kings 2:8).
- Compared each positive against *expected target Strong's IDs* and *expected verse witnesses*, rather than the permissive substring/alias test. Two screens are recorded: exact reference matching (comparable in spirit to the 2026-11-19 diagnostic ledger), and a second same-chapter **verse-range-aware** screen. Each is **unverified candidate retrieval**, not semantic relevance certification.

### Execution and stability

| Indicator | Previous live baseline | Discovery-2 retest |
|---|---:|---:|
| Benchmark cases | 239 | **239** |
| Distinct live query payloads in this run | 222 network requests, after within-batch deduplication | **190** (full cross-case deduplication) |
| Clean first-attempt queries | 222/222 | **183/190** |
| First-attempt downstream HTTP 503 errors | 0 | **7** |
| Subsequent retry successes | Not applicable | **7/7** |
| Cases with a usable final response (allowing retries) | 239/239 | **239/239** |
| `status:ok` after retries | 238 | **239** |
| `status:no_match` after retries | 1 (`yeast`) | **0** |
| Median successful first-attempt latency | 1,062 ms | **1,274 ms** |
| P95 successful first-attempt latency | 2,617 ms | **2,561 ms** |
| Maximum successful first-attempt latency | 3,719 ms | **4,115 ms** |

**503 incident details:** The seven *consecutive initial failures* were `Q136–Q142` / cases `S049, S050, S051, S052, S053, S054, S056` (Isaiah 11:2; Ezekiel 47:1; Genesis 2:10, 3:24, 2:9, 3:17, 11:9). The connected tool returned `Cloudflare relationship graph gateway HTTP 503`; its outer error wrapper labels them `INVALID_ARGUMENT`, but the actual underlying failure is HTTP 503, **not malformed benchmark arguments**. Subsequent requests and seven selective retries all worked. Read-only Supabase inspection showed an `ACTIVE_HEALTHY` project and active `bible-mcp` v44. This implicates the downstream corpus gateway path, **but the underlying reason (CPU, upstream limits, transient faults, cache behavior, etc.) is not established** by this test; do not assert a specific cause without Cloudflare request/error telemetry.

This is a **regression in observed first-pass availability** compared with the previous run. The two runs used different deduplication patterns and timing, so latency changes should not be interpreted as controlled performance improvements or regressions.

## 2. Retrieval improvement: exact-target witness screen

| Metric for 215 positive expectations | Before | After |
|---|---:|---:|
| Expected Strong/verse surfaced at or above case top-K (strict reference screen) | **98/215 (45.6%)** | **136/215 (63.3%)** |
| Net change | — | **+38 cases; +17.7 percentage points** |
| Cases newly gaining a target compared with old diagnostic screen | — | **51** |
| Cases losing a previously surfaced target | — | **13** |
| Source+expected-target verses co-present on a single card within top-K | Not evaluated on same rule | **43/215** |

A range-aware second screen (e.g. matching expected John 1:1 to a returned reference `John 1:1–3`) yields **137/215 within top-K**, **17/215 with targets only after their specified top-K but within top-25**, and **61/215 without a target in the 25 returned slots**. This separates ranking failures from apparent candidate-generation/coverage failures. Neither screen is a validated semantic precision/recall estimate.

| Positive category | Previous strict target screen | New strict target screen | Range-aware after top-K / absent within top-25 |
|---|---:|---:|---:|
| Linguistic form | 5/5 | **5/5** | 0 / 0 |
| Linguistic lexical | 18/23 | **18/23** | 4 / 0 |
| Linguistic polysemy | 5/5 | **5/5** | 0 / 0 |
| Linguistic translation | 20/22 | **21/22** | 1 / 0 |
| Direct intertext | **4/55** | **25/55** | **6 / 24** |
| Narrative chronology | 3/8 | **3/8** | 0 / 5 |
| Narrative pattern | 18/54 | **27/54** | 4 / 23 |
| Narrative genealogy | 0/3 | **0/3** | 1 / 2 |
| Real-world material | 7/14 | **9/14** | 1 / 4 |
| Real-world part/whole | 3/4 | **3/4** | 0 / 1 |
| Real-world process | 8/12 | **11/12** | 0 / 1 |
| Real-world property | 7/10 | **9/10** | 0 / 1 |

**Largest recovery:** direct intertext **4→25 of 55** with target references at specified rank. Adding xrefs to passage fast-assets clearly improved discoverability; nevertheless, **30/55 direct intertext tests still do not show the expected target within top-K**. Chronological and genealogical reasoning remains weak.

### Representative confirmed gains

1. **`W025: yeast`**: previously `no_match`; now `ok`, Hebrew `H7603` / `H2557` and Greek `G2219` with LXX passages and unleavened-bread links. A real query-resolution recovery.
2. **`S018: Hosea 6:2`**: `r11:xref:22286:28823` at **#4** shows **1 Corinthians 15:4** beside Hosea 6:2. Source text is retrievable. This is a credible *editorially curated intertextual comparison*, **not proof Paul explicitly quoted Hosea**.
3. **`D006: Genesis 6:18`**: reciprocal cross-reference to **Hebrews 11:7** at **#2**, both source witnesses available.
4. **`S050: Ezekiel 47:1`**: xref to **Revelation 22:1** at **#5** after successful retry.
5. **`L027: lamp / `G3088``**: `r12:path:G3088:G5459` at **#11** with direct endpoint witness **2 Peter 1:19** (lamp and light-bearing/morning-star language), endpoint status `DIRECT_ENDPOINT_WITNESS` and correctly caveated graph-path interpretation.
6. **`L002: Adam / dam`**: `r12:orth:H0120:H1818` at **#11**. Evidence explicitly classifies it **orthographic similarity only**, *not* demonstrated common root/etymology. This is a valuable exploratory lead, not a scholarly lexical proof.
7. **Negative controls `N001–N004`**: the old high-ranked, falsely documented **Hagar→ostrich, eye→angel, logos→kidney, covenant→wheel** endpoint paths are **absent throughout their returned top-25 lists**. The earlier misleading `documented_lexical_relationship` multihop classifications are not seen in the inspected replacements.

### Regressions: 13 lost strict target screens

- **Lexical/translation (4):** `L005` Abraham's offspring/seed, `L008` forgetting covenant, `L022` Hebrew-to-Greek bread, `L054` stranger/foreigner in separation laws.
- **Intertext (1):** `D017` hyssop/sprinkling and Hebrews.
- **Narrative (6):** `S001` Feast of Unleavened Bread and Red Sea crossing; `S006` Red Sea deliverance→baptism; `S009` Elijah/Elisha mantle and water-parting; `S012` Passover institution/chronology; `S023` restored child and later apostolic healing narrative; `S035` Zechariah lampstand/Spirit imagery.
- **Physical/world (2):** `W014` bronze altar material; `W024` vine/grape/branches.

**Important nuance:** some apparent losses are **ranking misses, not missing source data**. `L008` forgetting covenant is visible at **#21** but its threshold is #15; `L022` Greek bread at **#14** vs #12; `S009` Elijah/Elisha water-parting appears at **#14** vs #12. The same pattern explains `D001` Genesis 1:1 → John 1:1: the exact textual cross-reference `r11:xref:1:26152` exists at **#20**, but the expected top-K is **10**. The evidence tool confirms the two actual verses and their shared “in the beginning” wording. This is a ranking/placement failure, **not a dataset gap**.

## 3. Discovery quality and ranking diagnosis

### Top-five real estate is still dominated by lookup-style facts

Across the same 239 cases × five displayed slots = **1,195 positions**:

| Family | New occupied slots | Share |
|---|---:|---:|
| `r11:gram` | **385** | 32.2% |
| `r11:lxx` | **376** | 31.5% |
| `r12:path` | **200** | 16.7% |
| `r11:xref` | **39** | 3.3% |
| `r12:prop` | **8** | 0.7% |
| `r11:cluster` | **3** | 0.3% |

Grammar + LXX together occupy **761/1,195 = 63.7%** of top-five positions; these can be accurate yet are often basic dictionary/grammar facts, not the unexpected patterns users seek. Prior baseline `r11:gram` + `r11:cluster` occupied 819/1,195 (68.5%)—that specific clustering noise fell dramatically, but LXX now occupies much of the freed rank space.

**Ranking therefore remains too anchored to high-scoring local lexical facts.** Evidence source diversity and *discovery interestingness* must improve without compromising direct textual verification. Prioritize human-explorable chains, meaningful cross-book links and source-specific concepts over repeated top-of-list transliteration and grammar facts. Consider grouped lexical cards plus ranked *discovery leads* rather than forcing all evidence types to compete in one undifferentiated list.

### High-priority quality counterexamples

- **`D001` Genesis 1:1 / John 1:1**: true indexed reciprocal cross-reference is buried at **#20**, despite a user query explicitly anchored on Genesis 1:1. It should compete ahead of unrelated grammatical details, while clearly qualifying that a cross-reference alone is not authorial-proof.
- **`S001` Exodus 12:15 / crossing**: the expected coherent chronological connection is still absent from the case's top-K. `r12:event:1832:event:125` appears at #14 (Exodus 13:18), showing useful partial event coverage but not the whole requested sequence.
- **Incorrectly prominent `S001` cross-reference:** `r11:xref:1832:29274` ranks **#6** for Exodus 12:15 ↔ Galatians 5:12. Evidence reveals the shared “cut off” wording, but Galatians 5:12 concerns opponents of Paul's message, **not the Passover-to-Red-Sea chronology**. This is a real recorded cross-reference but a low-value answer to this discovery objective. Label source-presence separately from semantic/intent relevance.
- **`S006` Exodus 14:30 / baptism**: direct `r10:typo:1cor10_1_2_red_sea_baptism` is strong and properly qualified when querying **Exodus 14:21** (rank #1), but not when querying the adjacent deliverance verse 14:30 in its expected window. Passage-span and event routing must unify adjacent verses more coherently.
- **`S009` 2 Kings 2:14**: exact Elijah 2:8 parallel exists at rank #14, beyond the case's top-K. Strong same-event repetition should be privileged over unrelated word facts.
- **`N009` “three days resurrection”**: the old nonsensical **Genesis 5:23 / 365 years** rank-1 result is now gone. Yet current #1–4 results remain Genesis 7:13, 30:36, 40:12, 40:13 generic three-day occurrences, with **no resurrection topic grounding**. This is still a clear *multi-concept relevance failure*, even if the specific former numerical false positive is fixed.
- **Genealogy `0/3` target screens**: graph traversal/identity links are not yet reliably retrieving the benchmark's exact genealogical relationships. One target appears after its window; two were absent in top-25.

### Current handling of uncertainty and negatives

The four confirmed old false multihop IDs do not recur in top-25. The `N009` former 365-year false intersection and the old `N024` inflated lifted-eye structural ID are also absent. Correctly scoped `r12:orth` results do not claim etymological proof.

The inspected `r12:prop:G3088:H4501` evidence identifies its bridge as `external_world_bridge`, sourced from a **derived physical graph** with an explicit warning that physical-property similarity does not establish a biblical identification or authorial intent. This is better than the old fabricated Wikidata predicate problem. The spot check **does not prove every one of the 384 assertions has been audited independently**; rely on the agent's pinned compiler verification for the broader static corpus, not this spot check alone.

**Caveat on modern editorial links:** `r11:xref` has epistemic class `verified_cross_reference` and evidence prose that can suggest an “ancient editorial or intertextual connection.” The dataset source, CrossReferences.org/OpenBible, is a **modern cross-reference compilation**; the reference's existence is verified, but *ancient dependence or authorial intention is not*. Tighten the descriptive prose and scoring accordingly.

The **24 negative controls have been executed**, but **not all 24 have been independently semantically adjudicated**. Absence of a forbidden old ID is a meaningful regression pass for that exact counterexample, **not a complete proof against new forms of the same error**.

## 4. What to improve next (ranked)

**P0 — Recover production reliability and make failures observable.**
1. Investigate Worker telemetry for the `Q136–Q142` seven-request 503 burst (CPU-exceeded vs. asset fetch/integrity vs. upstream instability vs. quotas). Preserve exact query arguments, request timing and deployed Worker version.
2. Instrument structured failure reason, execution budget, asset I/O and per-stage timing without exposing private/restricted data.
3. Add bounded early termination, graceful partial-results responses, and safe caching/streaming improvements where supported; protect users from invisible downstream 503s. **Do not assert CPU as root cause without logs.**
4. Run a *small reproduction* with those seven queries before repeating an expensive full benchmark.

**P0 — Fix misleading relevance and evidence-class signals.**
1. An editorial xref is a *link to inspect*, not by itself evidence of ancient literary dependence; correct the `verified_cross_reference` explanatory contract.
2. Introduce source-to-target *mechanism coherence* (event, action, chronology, explicit wording, quotation/allusion, or true lexical formation) when ranking a pair for a specific query.
3. Separate source-verified statements from interpretive hypotheses; prevent superficial word overlap (e.g. Exodus 12:15↔Galatians 5:12 “cut off”) from outranking topic-relevant passages.
4. Preserve `r12-ranker-v2` path `K`/direct-endpoint witness checks; do not reintroduce old endpoint-composition failures.

**P1 — Passage-anchored retrieval and novel exploration ranker.**
1. Reserve competitive ranking opportunities for exact anchored-passage xrefs, event neighbors and motif connections; ensure passage-target cards are not buried under 5–10 routine grammatical/LXX facts. Start with `D001`, `S006`, `S009`, `S023`.
2. For multi-concept queries enforce coverage of *all governing concepts*, not merely an easy lexical match: `N009` must care about “resurrection,” not only “three days.”
3. Penalize redundant fact families; diversify *mechanisms* (intertextual, narrative, grammatical, orthographic, external-world, chronology) but never inflate weak evidence just for diversity.
4. Build meaningful multi-verse paths that show **full verse text, English gloss and transliteration, original tokens, bridge explanation, counterexamples and epistemic classification**; promote user-led exploration rather than a flat list of isolated cards.
5. Analyze the **13 strict retrieval regressions** before changing score constants. Use counterfactual ranking traces to distinguish pruned candidates, scoring changes, and top-K displacement.

**P2 — Extend real graph coverage without benchmark overfit.**
1. Expand beyond the **250 precomputed pilot anchors** while keeping Cloudflare asset/CPU budgets bounded; prioritize source-index-driven coverage rather than one hardcoded result per expected case.
2. Extend genealogical, event-sequence and physical-mechanism traversals with verified node/participant identities and source-scoped witnesses; genealogy and chronology have the largest relative remaining gaps.
3. Broaden the pinned **64 physical-concept mappings / 384 assertions** only through license-safe, provenance-clean offline extraction; never infer that shared material properties imply scriptural symbolism.
4. Separate primary answer relevance from optional exploratory speculation in ranking and UI.

**P3 — Stronger independent evaluation.**
1. Keep the **239 frozen cases**, first-attempt gateway failures, and negative controls unchanged. Add new *held-out* complex queries to resist scoring overfit.
2. Independently adjudicate every substantive candidate with `get_connection_evidence_v1` plus original biblical witnesses; establish semantic `PASS_AT_K / PARTIAL / FAIL_AT_K / INCONCLUSIVE` only after actual evidence review.
3. Record **target@K, verified-mechanism@K, epistemic precision, negative-control failures, mechanism diversity, novelty, explainability, and sustained availability** as separate measures.
4. Explicitly reject perfect scores produced by the same text-joining bug, etymology-overclaim or source provenance leak in different wording.

## 5. Files and handoff

- [Frozen expected connections and rules](../R12_EXPECTED_CONNECTIONS_180_PLUS.json)
- [Previous 239-case baseline](../live_mcp_retest_2026-11-19/R12_MCP_RETEST_ALL_239.json)
- [Previous 239-case diagnostic ledger](../R12_BENCHMARK_DIAGNOSIS_239.json)
- [Neon's improvements/deployment handoff](../R12_ALGORITHM_IMPROVEMENTS_HANDOFF.md)
- **[New complete per-case comparison matrix](R12_MCP_RETEST_ALL_239.json)** — every case, expected relationship, ranked top-five, target-screen outcome, source batch, first error/retry status, and rank-vs-coverage diagnostics.
- **[Query manifest](QUERY_MANIFEST.json)** — exact 190 argument payloads covering 239 cases.
- **Full top-25 raw response summaries:** 16 files, `batch_001_010.json` through `batch_179_190.json`, each preserving score, source references, original-language Strong's, provenance-related path metadata and ranking.
- **[Original 503 failures (batch 131–142)](batch_131_142.json)** and **[successful isolated retries](RETRY_503_Q136_Q142.json)**.
- **[Twelve independent evidence spot checks](EVIDENCE_SPOT_CHECKS.json)**.
- Two compact processed-query index files are included solely to make this matrix reproducible without reopening every large response batch.

**Recommended next step:** hand this report and the case matrix to Neon; prioritize the seven-request 503 recurrence, editorial-xref relevance, passage query ranking, and multi-concept intent coherence. **No production source code or service configuration was changed during this independent read-only retest.** The only writes were the benchmark artifacts committed to GitHub.
