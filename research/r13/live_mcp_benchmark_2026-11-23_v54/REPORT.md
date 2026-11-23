# BibleResearch — Independent live MCP benchmark, 23 November 2026

## Deployment and method

- **Observed backend:** Supabase Edge Function `bible-mcp` **v54** (ACTIVE, updated 2026-11-23 12:49:55 UTC; SHA `cb8917988570a7675d7c56687ea7cd6bbaf922ffe6eaf8856545f5a30f17115f`). The `research(op="lxx")` verification object reports Cloudflare production corpus release **`r13-discovery-3`**, Worker version `fa4b7d1b-7977-47a9-afa2-c657e7535769`, source commit `6f70561b5487e5d1033cdd72fd9578ed8e63f239`, assets SHA-256 `fb41be32c11135a5aacdac7101907b2a7ba0878472742db4160518986d9fd422`. These are reported version bindings, not an independent source-code audit.
- **Surface:** actual connected seven-tool BibleResearch MCP in ChatGPT. `get_prompt` version **2.0.0**. No credentials, writes, edits, notes, destructive operations, or deployments.
- **Observed:** 68 primary read-only calls: 18 `get_Word(connections=25,realworld=0)`, 28 `get_Passage(depth=25,word_depth=0,etymology=0,realworld=0)` canaries, 10 additional passages with identical settings, and 12 `get_Connection(connections=25)` comparisons. **68/68 returned `status:"ok"`; no observed 503/transport error.** Eight structured `research` operations also returned `status:"ok"`; the chain initialized/followed successfully; Psalm 3:0 and Genesis 31:55 passage reads succeeded.
- Each positive target is a **strict normalized Strong's target ID, passage `refs` entry, or explicit relation type in a ranked card**. Strong's targets must be the actual target/matched endpoint; English gloss-only matching does not count. `target@K` is retrieval recall **not** confirmation of sound interpretation, scriptural intention, independent evidence, or truth. Negatives are limited checks; total scores are **not theological accuracy**. Connector wall-clock timings from parallel calls are not Worker latency.

## Measured outcomes

| Test family | Calls | Observed check | Result |
|---|---:|---|---:|
| Word discovery (positive) | 15 | Expected target in stipulated top-K | **12/15 (80%)** |
| Word controls | 3 | Expected negative result absent from top-25 | **2/3**; third is a documented homograph candidate, not an established error |
| Passage discovery (positive) | 25 | Expected target in stipulated top-K | **23/25 (92%)** |
| Passage scene negative controls | 3 | Prior false scene endpoint absent from top-25 | **3/3** |
| Paired/multi-anchor `get_Connection` | 12 | `direct_link_found` matches prospective expectation | **10/12**; see semantic qualifications |
| New passage challenges | 10 | Target in stipulated top-K | **5/10** |
| Explicit quotation challenges (subset) | 4 | Target retrieved in top-10 | **4/4** |
| Thematic challenges (subset) | 4 | Target retrieved in top-15 | **1/4** |
| Research ops: grammar, LXX, intersection, evidence, passage comparison, occurrences, geography, numbers | 8 | Transport/operation status | **8/8 status ok**; one LXX alignments mode empty |
| Chain | 2 | Seed/follow H8247 → H8245 with evidence classification | **2/2 status ok** |

Across **56 word/passage discovery seeds**, the top-five slots contained **103 modern editorial cross-reference cards (36.8% of 280 slots)** and **59 `r13:wp` wordplay cards (21.1%)**. Of 190 passage-seeded top-five slots, 34 were R13 wordplay. These are *family composition* measures, not precision scores. Results are frequently duplicated by `r10` and `r13` records of the same lemma pair (e.g. Adam–adamah); reciprocal phonetic records can also occupy multiple slots.

## Verified strengths

1. `get_Word("H8247")` puts the genuine almond `שָׁקֵד` (H8247) ↔ watching `שָׁקַד` (H8245) pun at **#1**; `Amos 8:1` summer fruit `קַיִץ` (H7019) ↔ end `קֵץ` (H7093) at **#1**; Genesis 2:7 Adam `אָדָם` ↔ ground `אֲדָמָה` at **#1**. `research(op="evidence")` now returns original-language tokens, witness passages, morphological/orthographic details and limitations for a tested R13 wordplay ID.
2. `Revelation 4:5`, `Revelation 5:6` and `Revelation 1:20` all place an **explicit identification at #1**. Importantly, the last distinguishes lampstands = churches from seven lamps/eyes = Spirits; the referents are not collapsed in these samples.
3. Paired comparison finds an inspectable **`מְנוֹרָה` H4501 ↔ `λυχνία` G3087** bridge between Exodus 25:31 and Hebrews 9:2. The three-anchor Exodus 25:31 ↔ Zechariah 4:2 ↔ Revelation 11:4 comparison returns a complete 3-edge triangle. Genesis 6:14 ↔ Exodus 2:3 shares the original Hebrew `תֵּבָה` H8392. Numbers 21:9 ↔ John 3:14, Gen 2:7 ↔ 1 Cor 15:45 and Gen 1:1 ↔ John 1:1 also carry inspectable pair witnesses.
4. The three formerly spurious scene targets (Genesis 8:1 → Acts 20:35, Genesis 1:10 → Matthew 23:15, Exodus 16:4 → Matthew 19:3) are absent from the top 25. `Psalm 3:0` is still readable. `Genesis 31:55` also returns its expected verse identity.
5. The four **explicit** challenge links are found: Exodus 12:46 → John 19:36 (#3); Psalm 22:18 → John 19:24 (#5); Jonah 1:17 → Matthew 12:40 (#2); Psalm 16:10 → Acts 2:27 (#2).

## Important failures, with independent witnesses

### P0. Strong direct evidence exists but unilateral ranking omits it

- **`H1818` blood → `H5315` life absent from first 25** `get_Word("H1818")` results. Yet `research(intersect_words=["H1818","H5315"])` returns **28 same-verse attestations** and `get_Connection(["H1818","H5315"])` returns a valid pairwise textual convergence (Gen 9:4; Lev 17:11). This is an accessibility/ranking failure, not absent source evidence.
- `get_Passage("Zechariah 12:10")` does **not** return **John 19:37 in top 25**, although `get_Connection(["Zechariah 12:10","John 19:37"])` returns a direct textual xref plus `H1856` → `G1574` LXX/Greek pierce bridge. This was **#9** in the earlier `r12-discovery-3` compatibility benchmark: **confirmed same-endpoint regression**.
- Exodus 12:15 → Exodus 14:21 (unleavened-bread-to-sea-crossing chronology) is still absent in the unilateral first 25 and a related Exodus 12:15 ↔ 14:30 pair fails to build a direct proof. This is a *candidate narrative sequence*, not a direct textual citation; do not force `direct_link_found:true` simply to pass the benchmark.
- `H8141` → `H8138` only **#21** (K15); `H5397` → `H5315` **#18** (K15).

**Fix:** make verified pairwise evidence (exact lemma occurrence intersections, original-language LXX bridges, direct scriptural quotations, role-bound networks) available as a *candidate producer* for single-anchor discovery. Preserve strict evidence types, then rank with intent-aware reciprocal scoring; avoid costly all-pairs materialization.

### P0. `attested_textual_wordplay` is frequently over-asserted

- `get_Word("H8247")` ranks **H8247 almond ↔ H6485 `פקד` reckon** as “Attested biblical wordplay” **#3** based on phonetic similarity and Jeremiah 1:10–11 proximity. `research(evidence_id="r13:wp:H8247:H6485")` says an “explicit textual cue” exists while simultaneously warning that intentional authorial linkage is **not** independently demonstrated. The correct unambiguous pun in Jeremiah 1:11–12 is H8247 ↔ H8245.
- Revelation 4:5 returns **thunder `βροντή` ↔ throne `θρόνος`** as attested wordplay twice at #4 and #5; similarity/adjacency alone cannot establish intention.
- Hosea 11:1, Numbers 21:9, Exodus 12:15, and Genesis 22:13 are also distracted by weak phonetic or unrelated genealogical/entity cards (see raw top-25 results). These are often legitimate candidate forms but **not independently proven literary wordplay**.
- Separate `orthographic_similarity` / `phonetic_candidate` / `documented_lexical_root` / `verified_literary_wordplay`; default to candidate unless original-language verse structure, independently testable pun/naming/contrast/parallelism cues, and the *correct contextual lemma identities* warrant promotion. Give genuine wordplay a semantic/evidence margin above coincidences; deduplicate reciprocal and parallel records by canonical unordered lemma pair and witness.

### P0/P1. A graph “direct link” may prove proximity, not meaningful linkage

`get_Connection(["H0216","H5785"])` returns `direct_link_found:true` and a valid-looking graph proof. Its one verified edge is **close pericope proximity**: Hebrew light and skin appear in Lamentations 3:2–4. The co-occurrence is real, but it does not establish shared etymology, meaning, or literary intention. Do **not** label the raw proximity data false; instead expose `proximity_observed` separately from `explicit_pairwise_relation`, `semantic_hypothesis` and `authorial_intertext`. The control is failed as a **semantic negative**, not an incorrect verse match.

The `H7799` lily → `H7800` Susa string screen also fails strict “no link in 25” (H7800 appears #9): the server correctly selects H7799, lists H7800 as a **distinct homograph/alternative**, and offers a lexical/spelling relation, not synonymy. **Do not interpret this one control as a proven homograph contamination.** The benchmark should check whether homograph identities were conflated, not merely whether a flagged sibling appears anywhere.

### P1. Thematic and multistep discovery remains weak

Only **1/4** thematic challenge targets occurred by K15: Numbers 17:8 → Jeremiah 1:11 (#13). **2 Peter 1:19 → Revelation 22:16** and **Isaiah 11:2 → Revelation 4:5** are absent in top 25; **2 Kings 2:8 → Joshua 3:16** is #25 (K15). Genesis 22:13 → John 1:29 was exploratory and absent: this alone does **not** prove a missing authorial relationship. `Genesis 22:13` instead begins with distant pericope-genealogy candidate cards, not its immediate sacrifice frame.

**Fix:** use bounded, original-lemma anchored motif synthesis across multiple passages: first actor/action/object/result role frames and shared rare lemmas; then explicit internal biblical interpretations; then LXX witness alignments; then cautious typological hypotheses. Require connected subgraph proof for multi-anchor assertions, and score counterexamples/semantic drift. Keep Hebrew/Greek lemma identity authoritative rather than English gloss match.

### P1. Evidence and metadata parity issues

- `research(lxx,mode="compare",passage="Exodus 25:31")` **has both biblical editions** and a candidate ordinal alignment for H4501, while `research(lxx,mode="alignments",passage="Exodus 25:31")` and `mode="alignments",word="H4501"` return `total_returned:0`. `mode="translations",word="H4501"` does return documented Hebrew→Greek renderings. Investigate filtering/contract differences before calling this a data loss; distinguish *dictionary translation*, *inferred verse-token alignment* and *verified passage alignment* in all responses.
- `get_Passage("Genesis 2:7")` attaches **“Eden 2” = Til Barsip** as a “probable” location. `Genesis 2:8` gives both disputed “Eden 1” and “Eden 2” = Til Barsip. This may be conflating the Garden of Eden with *Beth-eden/Til Barsip*. Re-verify atlas place ID, referent, event association, precision and provenance. Do not geocode an uncertain Genesis setting as a probable modern point.
- R13's implementation report describes `discover_patterns`, `compare_patterns`, and `trace_evidence` as `research` operations. **The currently advertised connected `research` tool schema does not allow those three operation names**, even though basic pattern-derived cards are returned by `get_Word`/`get_Passage`. Update the connected MCP tool declaration / version handshake; do not claim these three operations were live-tested through the current tool.
- `research(evidence)` now hydrates tested R13 wordplay, but shows a legacy-looking `release_id:"r11-v1.0"` for an R13 ID; audit evidence-release provenance separately from corpus release. Confirm status 0-result versus unavailable versus misconfigured for each operation.

## Comparable prior-release canaries (same MCP interface, not a full A/B)

The 2026-11-23 `r12-discovery-3` **190-query / 239-expectation** compatibility benchmark measured **135/186 target@K = 72.6%** across its assessable frozen expectations. **Do not compare 72.6% to this new targeted suite's percentages**: the query sets, target conditions and denominators differ. The exact passage/target canaries are informative:

| Canonical source → target | Earlier R12 release-3 | Live R13 discovery-3 / v54 | Assessment |
|---|---:|---:|---|
| Gen 1:1 → John 1:1 | #6 | #5 | small gain |
| Josh 2:18 → Matt 1:5 | #5 | #4 | small gain |
| Gen 1:26 → Gen 9:6 | #19 | #14 | gain, still misses historical K10 |
| Isa 61:1 → Luke 4:18 | #2 | #3 | small displacement, still found |
| 2 Kgs 2:14 → 2 Kgs 2:8 | #1 | #2 | small displacement |
| Gen 2:7 → 1 Cor 15:45 | #4 | #7 | regression in rank but still top-10 |
| Zech 12:10 → John 19:37 | #9 | **absent top-25** | **serious regression** |
| Blood H1818 → life H5315 | absent | absent | critical unresolved |
| Hosea 11:1 → Matt 2:15 | #1 | #3 | small displacement |

R13's existing **32/32 local acceptance benchmark** is not disproved by these results; it tests a different, mostly preselected suite and interface. It is insufficient as the sole success metric for genuine discovery, semantic relevance and live interface parity.

## Recommended next round

1. **Freeze a shared live regression suite** using these raw canaries plus the original 239 frozen cases, including hard negatives with adjudicated evidence types and unmodified exact target/ref rankers. Track *recall@K, semantic precision@5 (human or blinded judge), verified-proof coverage, novelty/diversity, spelling false-positive rate, and missing-result explanations* separately. Prevent overfitting by holding out books/semantic families.
2. **P0 fix wordplay classification and candidate deduplication**, but do not suppress correct rare genuine puns. Require original token positions, lemma identities, rhetorical cues and provenance to promote to “attested”.
3. **P0 fix unilateral retrieval recall** by sharing candidate generation with `get_Connection` and `research`: specifically Zech 12:10↔John 19:37, blood↔life, and narrative chronology. This is a better first lever than retuning weights on incomplete candidates.
4. **P1 split semantics of proof** (co-location, shared root, grammatical co-argument, explicit scriptural identification, editorial reference, interpretive pattern). Graph completeness alone is not theological or linguistic proof.
5. **P1 expose new R13 operations in public MCP schema**, resolve LXX alignment mode parity and Eden identity, then rerun *both* compatibility and evidence-centric benchmarks with production-version provenance. Keep website graph and MCP ranking on the same evidence model but allow UI-specific display/limits.

## Raw test records

- [18 lexical/negative-control calls](WORDS_18.json)
- [14 passage canaries A](PASSAGES_A_14.json)
- [14 passage canaries B](PASSAGES_B_14.json)
- [10 additional explicit/thematic/exploratory challenges](CHALLENGE_10.json)
- [12 paired/multi-anchor proof calls](COMPARISONS_12.json)
- [8 research operations, Psalm heading / MT identity, anchored word and chain](RESEARCH_AND_CHAIN.json)
- [LXX mode, geo-identity, direct-proof and wordplay diagnostics](DIAGNOSTICS.json)

**Scope:** read-only empirical benchmark of the live connected interface. Repository reports only were added; source code, weights, corpus, deployment and user notes remain untouched.
