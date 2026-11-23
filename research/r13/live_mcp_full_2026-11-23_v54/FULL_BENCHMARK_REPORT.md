# BibleResearch — Full independent live benchmark

**Run date:** 2026-11-23 · **Scope:** full frozen R12 compatibility suite against live R13 MCP · **Branch:** `feat/r12-qa-fixes` · **Writes:** repository benchmark/report artifacts only, no code, database, Worker, notes, or ranking changes.

## Executive result

**All 239 frozen case queries were represented by 190 distinct requests, and all 190 ultimately returned full results. Four word lookups initially had `status:partial`, `discovery_status:unavailable` and profile-only links, and were successfully recovered on retries (H0216, H4194, H0784, barley). The original and recovered statuses are retained in BATCH_14.json.**

| Fixed, identically rescored metric | R12-discovery-3 baseline | Live R13-discovery-3 / Supabase v54 | Delta |
|---|---:|---:|---:|
| Read-only distinct query attempts | 190 | 190 (4 transient partial recoveries) | — |
| Positive frozen expectations | 215 | 215 | — |
| Machine-assessable positive targets | 186 | 186 | — |
| Positive targets at original top-K | **132/186 (71.0%)** | **126/186 (67.7%)** | **−6 (−3.2 percentage points)** |
| Positive targets anywhere in top-25 | **147/186 (79.0%)** | **138/186 (74.2%)** | **−9** |
| Positive targets absent in top-25 | **39/186** | **48/186** | **+9 misses** |
| Newly passing / newly failing at top-K | — | **7 gains / 13 losses** | Net **−6** |
| Other positive cases without strict ID/ref target | 29 | 29 | Unassessable |
| Negative controls in frozen suite | 24 | 24 | Queries executed; **no comprehensive semantic adjudication** |

**Interpretation:** The live R13 rollout does **not** demonstrate overall retrieval improvement on the old frozen compatibility suite. It has important evidence-quality advances and new discovery types, but strict comparable target retrieval has decreased. A target ID appearing within a card is *recall*, not verified interpretive correctness. The prior R12 published benchmark used a slightly different target matcher and reported 135/186 = 72.6%; we rescored the original raw R12 190 responses with **exactly the same scorer as R13**, yielding 132/186. That recomputation reproduces **182/186** historical case ranks exactly. Use **132→126**, not **135→126**, for fair comparison.

## Deployed versions

- Supabase `bible-mcp` **v54** ACTIVE; updated 2026-11-23 12:49:55 UTC; SHA `cb8917988570a7675d7c56687ea7cd6bbaf922ffe6eaf8856545f5a30f17115f`.
- `research(op=lxx)` reported corpus release `r13-discovery-3`, Cloudflare Worker version `fa4b7d1b-7977-47a9-afa2-c657e7535769`, source commit `6f70561b5487e5d1033cdd72fd9578ed8e63f239`, assets SHA-256 `fb41be32c11135a5aacdac7101907b2a7ba0878472742db4160518986d9fd422`.
- Deployed provenance fields are self-reported by the service, not independently rebuilt/verified from source in this run.

## Benchmark procedure and limitations

Used the same **190 individual query strings and tool routes** as the 2026-11-23 archived R12-release3 compatibility benchmark, across the archived `BATCH_01.json`–`BATCH_14.json`. Each query was called through the connected live MCP:
- Passage: `get_Passage({passage:q,depth:25,word_depth:0,etymology:0,realworld:0})`.
- Word: `get_Word({word:q,connections:25,etymology:0,realworld:0})`.
- Saved all top-25 results' IDs, titles, epistemic classification, relation/evidence type, references, normalized Strong's targets, matched endpoints, and short explanations.
- Matched frozen expected **literal Strong's IDs** or **canonical verse references, including range overlap**, against ranked cards. Did not score broad English-gloss hits. Same rules re-scored the saved R12 baseline. Case-specific top-K retained.
- The archived `discover_biblical_connections_v2` had `max_hops` and `mode`; this compatibility protocol does **not** reproduce the original engine RPC or its original `bridge` behavior. **40 bridge-mode positives** need a dedicated explicit `get_Word(mode:"bridge")` secondary analysis to assess bridging on the current API; do not call their failed compatibility expectations true engine failures.
- The 24 negative-control queries ran, but the automatic *verbatim forbidden-claim screen* is not a reliable semantic proof. Their final adjudication remains **0/24**. An independent six-pair proof spot-check was run and saved separately. No Worker CPU latency, free-tier resource/billing utilization, global recall, or comprehensive human semantic precision was measured.

## Category-level comparable target recall@K

| Category | R12 | R13 |
|---|---:|---:|
| Linguistic form / wordplay | **5/5** | **5/5** |
| Lexical relationships | **6/22** | **9/22** |
| Polysemy | **1/3** | **0/3** |
| LXX / translation | **21/22** | **18/22** |
| Direct intertext | **51/55** | **50/55** |
| Narrative chronology | **4/8** | **3/8** |
| Narrative patterns | **36/54** | **34/54** |
| Genealogy | **3/3** | **3/3** |
| Physical/material | **3/8** | **2/8** |
| Physical part/whole | **1/2** | **2/2** |
| Physical process | **0/2** | **0/2** |
| Physical property | **1/2** | **0/2** |

These category denominators count **mechanically assessable** frozen expectations only, not all cases in the frozen suite. In particular, the physical/process samples are tiny and incompatible historic bridge modes affect interpretability.

## Top-five ranking composition (190 queries × 5 cards = 950 slots)

| Family | R12 slots | R13 slots | Meaning |
|---|---:|---:|---|
| Editorial cross-references (`r11:xref`) | 383 | **376** | Still 39.6% of all top-five slots |
| Scene parallels (`r12:scene`) | 137 | **30** | R13 filtering strongly suppresses old scene family; some of this is deliberate denoising |
| Original-language wordplay (`r13:wp`) | 0 | **146** | New candidate family takes 15.4% of top-five |
| High-PMI lexical collocations (`r13:colloc`) | 0 | **46** | New candidate family |
| Grammar (`r11:gram`) | 131 | **94** | Less dominance |
| Septuagint (`r11:lxx`) | 77 | **51** | Reduced visibility; some valid alignments may be displaced |
| Named entities (`r12:entity`) | 30 | **28** | Similar |
| Preexisting multi-hop (`r12:path`) | 45 | **25** | Reduced path visibility |

**Interpretation:** The lower total recall should not be naively attributed to bad R13 code; rejecting false scene parallels is beneficial. But R13 wordplay often fills the reclaimed slots with merely nearby phonetic resemblances that should be exploratory, not asserted as verified literary puns. The benchmark needs a **precision@5 semantic adjudication** to measure whether useful surprise increased despite the lower target recall.

## Meaningful improvements

1. `H8247` almond `שָׁקֵד` ↔ watching `שָׁקַד` `H8245` is a strong original-language literary pun. `get_Word("H8247")` returned it at #1. Amos 8:1–2 `קַיִץ` summer fruit ↔ `קֵץ` end and Genesis 2:7 Adam ↔ `אֲדָמָה` soil are also found prominently.
2. Explicit scriptural identifications in Revelation 4:5 (seven lamps = seven Spirits), Revelation 5:6 (seven eyes = seven Spirits), Revelation 1:20 (seven lampstands = churches) are correctly differentiated in all sampled connected-MCP results.
3. Formerly spurious `Genesis 8:1 → Acts 20:35`, `Genesis 1:10 → Matthew 23:15`, and `Exodus 16:4 → Matthew 19:3` scene links disappeared from top-25; this is evidence of useful denoising.
4. `get_Connection` now produces inspectable original-language evidence for Noah's ark `תֵּבָה` ↔ Moses' basket `תֵּבָה`, and for Exodus 25:31 ↔ Hebrews 9:2 with `מְנוֹרָה` ↔ `λυχνία`. It rejects unrelated Hagar/kidney and Genesis 1:1/Obadiah 1:8 as direct links.
5. In the frozen benchmark, lexical relationship target@K improved from **6/22 to 9/22**. This is the strongest category-level quantitative gain.

## Failures and likely mechanisms

### P0 — Regression in direct cross-reference visibility

- **D050 `Zechariah 12:10` → `John 19:37`: #9 → #25**; misses K10, although paired `get_Connection` immediately returns the direct textual witness and `דָּקַר` H1856 ↔ `ἐκκεντέω` G1574 bridge.
- **L003 `H1818` blood → `H5315` life: absent in top-25 in both releases**, even though `research(intersect_words)` and paired `get_Connection` find **28 same-verse witnesses**, including Genesis 9:4 and Leviticus 17:11. This is candidate sharing/ranking failure.
- Other major top-K losses include L009 (polysemy), L036/L040/L041 (translation), D035, S013/S023/S025/S062 (narrative), W009/W027 (physical). See `EVALUATION_239.json` for exact old/new ranks and all gains/losses.
- Missing `Exodus 12:15 → Exodus 14:21` unleavened-bread-to-sea-crossing **narrative sequence** remains a candidate chronology case, **not** a scriptural assertion that the feast explicitly commemorates the sea crossing.

**Action:** unify evidence/candidate generators between `get_Connection` and unilateral `get_Word`/`get_Passage`. Inject *direct canonical citations, exact original-lemma links, verse-level coattestation and primary narrative progressions* before intent-sensitive reranking. Use strict duplicate suppression so redundant candidate families cannot consume result budgets.

### P0 — Wordplay evidence misclassification

- `H8247` almond ↔ `H6485` `פָּקַד` (reckon) appears **#3** as “Attested biblical wordplay”; evidence hydration explicitly says only nearby phonetic resemblance, without independent proof of intentional rhetorical wordplay.
- `Revelation 4:5` produces **thunder `βροντή` ↔ throne `θρόνος`** as *attested wordplay* twice in top-five, despite no demonstrated intentional pun.
- `get_Word("G3056")` returns “Attested biblical wordplay: `λόγος` ↔ `μάγος`” at #1, citing consecutive Acts 13 verses. Adjacency and partial letter overlap are insufficient for that classification.
- `three days resurrection` routes to Hebrew `H6965` “to rise” as though ordinary *rising* were always resurrection; top result is **1 Samuel 3:8**, an inappropriate “direct textual convergence” for actual death-and-restoration research.

**Action:** enforce separately calibrated classes `documented_root_relation`, `attested_literary_wordplay`, `candidate_phonetic_parallel`, `mere_orthographic_similarity`. A claimed attested pun needs original token identities, meaningful textual cue, correct lemma/sense, relevant shared passage or tightly bound rhetorical context, plus provenance. Penalize casual distance-1 substrings and declutter reciprocal variants. For resurrection-like concept queries demand death/revival context, not a polysemous rising lemma.

### P0 — `direct_link_found` proves topology, not meaningful relation

Focused pair QA: **5/6 checks** matched prospective semantic expectations. Hagar `H1904` + kidney `H3629` -> false; Genesis 1:1 + Obadiah 1:8 -> false; Exodus 25:31 + Hebrews 9:2 -> true; Zechariah 12:10 + John 19:37 -> true; Genesis 11:9 + Acts 2:6 -> false (possible literary *hypothesis* is not direct citation). **H0216 light + H5785 skin -> true**, because the two occur **two verses apart** in Lamentations 3:2–4. That is a real contextual proximity, but does **not** prove synonymy, shared etymology, or authorial pattern.

**Action:** return `cooccurrence_observed`, `contextual_proximity`, `direct_semantic_relation`, `explicit_scriptural_interpretation`, `literary_hypothesis` and `graph_connected` as **distinct** properties. Preserve real proximity as a useful low-tier candidate instead of deleting the edge, but do not make `direct_link_found` semantically overpromise.

### P1 — R13 live schema and LXX modes

The live MCP `research` schema does **not** advertise R13-native `discover_patterns`, `compare_patterns`, or `trace_evidence` as operations. We ran the **32 frozen R13-specific cases** via explicitly labelled adapters:
- **29/29 available compatibility smoke checks passed.** Twenty-four are adapted single-anchor `get_Word`/`get_Passage` approximations, one uses `research(evidence)`, and four use direct supported word/connection tools.
- **Three cases unexecutable through the connected schema:** `R13-MT-01` (`discover_patterns`), `R13-SI-04` and `R13-HO-U5` (both `compare_patterns`).
- These proxy checks **do not equal native 29/29 or 32/32 R13 benchmark performance**. They do not reproduce the original free-form discovery query, motif mining, cross-pattern logic, or native validation pipeline. Fix schema/transport, then run the unmodified full R13 suite against the native RPC.

In supplemental diagnostics, `research(lxx,mode="compare",passage="Exodus 25:31")` returned verse tokens and candidate H4501 alignment, whereas `mode="alignments"` for that passage and word returned 0. This may be a distinct operation contract rather than absent data; verify before claiming a data-integrity failure. Also disambiguate Garden of Eden and Beth-eden/Til Barsip geospatial referents in Genesis 2 location outputs.

## Exact rank highlights

| Frozen case | R12 | Live R13 | Result |
|---|---:|---:|---|
| D001 Genesis 1:1 → John 1:1 | #6 | **#5** | improvement |
| D003 Genesis 1:26 → Genesis 9:6 | #19 | **#14** | improvement but K10 still missed |
| D042 Isaiah 61:1 → Luke 4:18 | #2 | **#3** | still within K10 |
| D050 Zechariah 12:10 → John 19:37 | #9 | **#25** | serious top-K regression |
| D025 Numbers 21:9 → John 3:14 | #2 | **#3** | still within K10 |
| D004 Genesis 2:7 → 1 Cor 15:45 | #4 | **#7** | still within K10 |
| S028 Joshua 2:18 → Matthew 1:5 | #5 | **#4** | improvement |
| L003 blood H1818 → life H5315 | absent | **absent** | important unresolved recall |
| S001 Exodus 12:15 → sea-crossing narrative | absent (strict rescored) | **absent** | chronology gap |

## Recommended implementation order

1. **Freeze this report as an acceptance baseline.** Keep existing 239 frozen cases; add the actual seven-tool MCP JSON response and the R13-native discover/compare/trace operations as separate test protocols. Track exact `target@K`, `verified_pair_proof@K`, semantic `precision@5`, relevant-surprise/novelty, false-attested-pun frequency, latency/Worker reads, and epistemic label accuracy. Hold out test books/concepts from weight tuning.
2. **Fix candidate recall** (D050, L003, missing LXX, event spans) before changing scores. Differentially trace candidate generation, filtering, evidence hydration, MMR quota and output truncation; confirm each expected witness survives all stages.
3. **Correct wordplay and sense classification** (H8247/H6485, G3056/G3097, thunder/throne, H6965 resurrection). Do not remove true Jeremiah 1 almond/watch, Amos 8 fruit/end or Adam/ground connections.
4. **Strengthen motif/scene semantic-role checks** by actor/action/object/result agreement, independent original-language witnesses and explicit refutation/counterexample penalties. Avoid a false zero-sum trade-off in which removing wrong scenes simply promotes wrong puns.
5. **Align MCP and website graph** to the same typed edge/proof schema, while allowing concise MCP rendering and graph UX; expose missing native R13 operations before claiming full native acceptance.

## Artifacts (all committed to the same GitHub branch)

- [Final 239-case comparable machine evaluation](EVALUATION_239.json): each frozen case, original target, prior/new rank, top-K outcomes, gains and losses.
- [Re-scored R12 baseline](R12_REEVALUATED_SAME_SCORER.json): exact matcher reused to avoid misleading benchmark-comparison drift.
- [Original R13 top-25 cards for all 190 queries](.): `BATCH_01.json` through `BATCH_14.json` (initial partial and recovered statuses retained).
- [32-case R13 proxy acceptance scoring](R13_ACCEPTANCE_PROXY_SCORE.json) plus [raw A](R13_ACCEPTANCE_PROXY_A.json) / [raw B](R13_ACCEPTANCE_PROXY_B.json).
- [Six direct-link positive/negative proof checks](NEGATIVE_PAIR_SPOTCHECKS.json).
- [Earlier targeted R13 live diagnostic benchmark](../live_mcp_benchmark_2026-11-23_v54/REPORT.md).

**Bottom line:** R13 is functioning and shows valuable new evidence types and some safer negative behavior, but **the broad frozen full-suite retrieval metric currently regressed**. The fastest route to meaningful gains is *shared candidate generation, original-language evidence validation, strict classification, and ranking diversity*, not blindly increasing R13 weights.
