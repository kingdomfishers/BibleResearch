# BibleResearch R13 — full frozen 239-case LIVE MCP benchmark
**Date:** 2026-11-23. **Backend:** Supabase `bible-mcp` v54; reported Cloudflare corpus `r13-discovery-3`. **Branch:** `feat/r12-qa-fixes`. **Read-only**: no application code, corpus, ranking weights, deployment, or notes changed.

## 1. Execution
Ran **all 190 distinct queries** from `research/r12/R12_EXPECTED_CONNECTIONS_180_PLUS.json`, covering **239 frozen expectations** (215 positives and 24 negatives), against the actual connected `get_Word` and `get_Passage` MCP tools. **190/190 returned status ok; 0 exceptions/503.** `get_Word(connections=25,etymology=0,realworld=0)` for discover mode, `get_Word(mode="bridge",connections=25,etymology=0,realworld=1)` for bridge mode, and `get_Passage(depth=25,word_depth=0,etymology=0,realworld=0)` for passage queries. All top-25 card IDs, titles, refs, target Strong's, epistemic classes and relations were saved in 13 RAW batches.

**Scoring qualification:** To avoid credit for translation/gloss coincidences, the automated screen matches exact Strong's IDs in the target/endpoints or titles, or exact Bible references in card refs/titles, and inherits the earlier benchmark's **186 assessable positives**. It is a strict target-presence proxy, not an independently adjudicated truth test. **Do not claim the screen is bit-for-bit identical to the previous evaluator**: the previous scoring implementation was not rerun here, and R13 now explicitly enables `bridge` for word queries while the previous report stated that bridge mode was unavailable. Range-based citations such as `Acts 15:15-17` vs expected `Acts 15:16` and `John 1:1-3` vs expected `John 1:1` can be undercounted. The 24 negative controls were **executed but not semantically scored**; their null match values are not 24 passes. For fair A/B, rerun the exact same evaluator on both saved raw datasets or rerun both releases under identical parameters.

## 2. Full frozen-suite retrieval proxy

| Metric | Prior R12 release-3 report | R13 v54 live strict screen |
|---|---:|---:|
| Unique MCP queries successful | 190/190 | **190/190** |
| Frozen expectations | 239 | **239** |
| Assessable positives | 186 | **186** |
| Exact target at required K | 135/186 (72.6%) | **124/186 (66.7%)** |
| Target somewhere in top 25 | 150/186 | **137/186** |
| Present only after required K | 15 | **13** |
| Absent in top 25 | 36 | **49** |
| New passes / losses relative to prior case outcomes | — | **8 gains / 19 losses** |

This is an **observed regression under a stricter, not yet identically calibrated screen**, not a verified apples-to-apples 6-point quality decrease. The complete per-case data is in [EVALUATION_239.json](EVALUATION_239.json).

| Category | Prior at K | Current at K |
|---|---:|---:|
| Original-language form / wordplay | 5/5 | **5/5** |
| Lexical | 6/22 | **9/22** |
| Polysemy | 1/3 | **0/3** |
| LXX/translation | 21/22 | **18/22** |
| Direct intertext | 51/55 | **47/55** |
| Narrative pattern | 36/54 | **34/54** |
| Narrative chronology | 5/8 | **2/8** |
| Genealogy | 3/3 | **3/3** |
| Physical/material | 4/8 | **3/8** |
| Physical part-whole | 1/2 | **2/2** |
| Physical process | 1/2 | **0/2** |
| Physical property | 1/2 | **1/2** |

## 3. Live top-five ranking distribution (190 queries × 5 = 950 slots)

- **`r11:xref`: 375 (39.5%)**; `r13:wp`: **134 (14.1%)**; `r11:gram`: 97 (10.2%); `r10`: 59 (6.2%); `r11:lxx`: 51 (5.4%); `r13:colloc`: 38 (4.0%); `r12:scene`: 30 (3.2%); `r12:entity`: 28 (2.9%); `r13:motif`: **13 (1.4%)**; others 125 (13.2%).
- The old R12 release-3 report had **383 `r11:xref`**, **137 `r12:scene`**, **30 `r12:entity`**, and **0 `r13:wp`** among top-five slots. The R13 addition reduces overdominance of scene cards but puts 134 wordplay cards near the top. This measures source-family diversity, **not** correctness or meaningful novelty.

## 4. Confirmed retrieval regressions / missing connections

**Most concerning:**
- **Zech 12:10 → John 19:37:** earlier #9, now absent top-25; paired `get_Connection` still retrieves it with original-language pierce witness. A direct biblical citation should not disappear behind editorial neighbors.
- **Amos 9:11 → Acts 15:16:** earlier #1, now strict screen absent. The new top card **is Acts 15:15–17**, which **contains verse 16**. This is **a scoring false negative** due to range containment, not a genuine retrieval regression. Fix the benchmark matcher first.
- **Psalm 110:1 → Mark 12:36:** earlier #2, now absent under strict exact target screen; other clear NT Psalm 110 quotations remain top 7, so this is a *specific target coverage* issue rather than a failure to find the Psalm's NT reception.
- **Jeremiah 31:31 → expected NT covenant citation:** earlier #6, now #22, below K10.
- **Exodus 12:15 → sea crossing sequence:** earlier #18, now absent; do not confuse this candidate chronology with an explicit textual citation.
- **Ezekiel 37:12 → Matthew 27:52:** earlier #3, now absent; this is an exploratory resurrection motif, not an asserted direct quotation.
- **H1818 blood ↔ H5315 life:** still absent from unilateral top-25, despite **28 direct same-verse attestations** in the live intersection and pair-comparison tools.

**New gains to verify:** H4501 lexical/LXX connection #17→#6; H0231 #14→#5; Exodus 12:13 #13→#6; Exodus 19:18 #23→#13. The exact identity and evidence behind these results are recorded in the per-case JSON.

## 5. Evidence quality and R13-specific problems

1. **Unjustified wordplay promotion.** `get_Word("H0120")` returns Adam–adamah at #2, but also promotes Adam–east `H6924` at #4 as “attested biblical wordplay” without independent demonstration. `get_Word("H8247")` similarly promotes almond–reckon `H6485`; Revelation 4:5 promotes thunder–throne. Preserve spelling candidates but require a real original-language literary cue and correct contextual lemmas for an *attested* label.
2. **Motif graph semantic contamination.** `get_Word("H1285")` returns top-2 triangle motifs including `H0894` Babylon and `H4805` (glossed “Egypt”) with covenant and cut. These need lemma-identity, sense and actual witness-role audits. A triangle of graph edges is not automatically a coherent shared biblical motif; avoid presenting unrelated cross-chapter word triangles as a verified discovery.
3. **Top-25 budget competition.** The 134 R13 wordplay cards in top-five slots compete with direct citations and original-language relationships; deduplicate multiple evidence cards about the same canonical pair, distinguish direct verse quotation from editorial xref, and impose evidence-aware diversification.
4. **Semantic negative controls remain unadjudicated.** 24 frozen negative queries were run, but a valid negative test must examine the actual *claim* and proof class, not whether the target string appears. The prior separate 12-pair test showed `H0216` light and `H5785` skin have real proximity, which must not be promoted to meaningful semantic or etymological proof.
5. **Cross-tool candidate generation mismatch.** `get_Connection` and `research` can locate several high-value witnesses that `get_Word` and `get_Passage` fail to surface; fix candidate generation before fine-tuning weights.

## 6. Next improvement plan

**P0 — Calibrate the benchmark:** Reuse the previous evaluator exactly, including range containment, edition aliasing, Strong's normalization, and explicit `bridge`-mode parity; independently adjudicate all 24 negatives. Report raw retrieval, semantic precision@5, and evidence-proof validity separately.

**P0 — Repair evidence generation and ranking:** (a) shared verified candidate producers across single-anchor and paired tools, (b) exact original-language lemma/occurrence identities, (c) explicit quotation and self-interpretation before generic editorial xrefs, (d) avoid declaring proximity or consonant similarity as literary proof, (e) deduplicate canonical edge families.

**P1 — Motif synthesis:** Score multi-passage motifs by actor/action/object/result agreement, multiple independent witness passages, rare original-language features, LXX bridges and biblical internal interpretation; show graph counterevidence, uncertain steps and why each edge is relevant. Prefer small evidence-connected subgraphs over free-floating 3-node triangles.

**P1 — Interface parity:** Expose R13 pattern operations in the connected MCP schema, and use the same evidence model for website graph and MCP. Keep query output compact but proof hydration on demand.

**Acceptance criteria:** frozen 239-case screen with calibrated scorer must not regress; explicit quotation retrieval at top-10 must remain high; semantic precision@5 and graph proof coverage must improve without increasing spurious wordplay; 190/190 live queries successful. A new holdout suite is needed to detect benchmark overfitting.

## Files
- [Raw MCP results 1–13](RAW_01.json) (see directory for RAW_02 through RAW_13)
- [Full per-case evaluation and category statistics](EVALUATION_239.json)
- [Earlier R13 independent 68-call diagnostic benchmark](../live_mcp_benchmark_2026-11-23_v54/REPORT.md)
