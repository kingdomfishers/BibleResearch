# BibleResearch R12 — Independent live release-3 ranking & evidence QA

**Date:** 2026-11-23, Switzerland time. **Status:** Live read-only evaluation; benchmark files committed to `feat/r12-qa-fixes`. No ranking code, Worker deployment, Supabase data, or notes changed.

## 1. Release and test scope

Verified Cloudflare active `bibleresearch-corpus` deployment at **2026-11-23 01:27:43 UTC**, Worker version **`e44b4b5a-24c2-4bf7-8d88-10762c9e4f3d`**, `R12_RELEASE_ID=r12-discovery-3`, `R12_ASSET_SHA256=e0f4476489e98b3117e0546ef38d9b70f90282d66b059a1bb0f5abf90e040921`. Worker binding `R12_SOURCE_COMMIT=f4cff1c95a5d4c291dd03f85c3a01b21d7ce2f7a`.

**Crucial source-control finding:** the connected GitHub branch's `src/relationships/r10-discovery.ts` and `scripts/corpus-relationships-rpc.mjs` do **not contain** any of the newly observed `r12:scene:`, `r12:entity:`, or `r12:prog:` generation logic. The Worker source-commit binding is still the previous report commit, not a commit of the newly deployed algorithm. The implementation may live only in the user's local workspace/deployment. **Push reviewed implementation source and update the deploy-provenance binding before additional algorithm work, so it can be audited and reproduced.** Do not push generated data/private credentials or overwrite unrelated local edits.

Method: reran all **190 unique inputs representing the 239 frozen expectations** against live `get_Passage(depth=25,word_depth=0,etymology=0,realworld=0)` and `get_Word(connections=25,etymology=0,realworld=0)`. Compared **same interface, same query set, same top-K, same exact Strong's ID / canonical reference proxy** as the archived [2026-11-22 compatibility benchmark](../live_mcp_compat_retest_2026-11-22/COMPATIBILITY_EVALUATION_239.json). Source [frozen cases](../R12_EXPECTED_CONNECTIONS_180_PLUS.json).

**Do not confuse with legacy direct discovery RPC scores.** The original `discover_biblical_connections_v2` accepted `mode` and `max_hops`, which these two MCP tools do not expose. The frozen suite includes **40 positive bridge-mode cases** where original mode cannot be reproduced; **29 other positive expectations lack a literal structured target ID/ref** so our strict machine screen cannot judge them. `target@K` indicates the target was mentioned in a result card, *not* that the connection was valid or useful. 24 negative controls were not exhaustively semantically adjudicated.

## 2. Recomputed results

| Identical compatibility metric | 22 Nov baseline | 23 Nov live release-3 | Change |
|---|---:|---:|---:|
| Successful unique queries | 190/190 | **190/190** | stable |
| Frozen positive / negative cases | 215 / 24 | 215 / 24 | frozen |
| Mechanically assessable positives | 186 | 186 | identical |
| Exact target in case-specific top-K | **110/186 (59.1%)** | **135/186 (72.6%)** | **+25, +13.4 percentage points** |
| Target anywhere in top-25 | 137/186 | **150/186** | +13 |
| Expected target absent in first 25 | 49/186 | **36/186** | -13 |
| Present only after required K, within 25 | 27/186 | **15/186** | -12 |
| Newly passing vs newly failing top-K cases | — | **29 gains / 4 losses** | net +25 |
| `r11:gram` + `r11:lxx` in top 5, across 950 unique-query slots | 594 (62.5%) | **208 (21.9%)** | -40.6 pp |
| `r11:xref` in first five | 28 (2.9%) | **383 (40.3%)** | +355 slots |
| `r12:scene` in first five | absent | **137 (14.4%)** | new source family |
| `r12:entity` in first five | absent | **30 (3.2%)** | new source family |

The old grammar/LXX monopoly is largely removed, **but xrefs + new scene cards now consume 520/950 = 54.7% of all top-five slots**, and **519/595 = 87.2% of passage-seeded top-five slots**. More diversity and relevance verification are still needed. A modern editorial xref is a research lead, not authorial evidence.

**Mechanically assessable category recall@K (previous → current):**

- Direct intertext: **41/55 → 51/55** (+10; 13 gains, 3 losses).
- Narrative patterns: **26/54 → 36/54** (+10; 11 gains, 1 loss).
- Narrative chronology: **3/8 → 5/8** (+2).
- Genealogy: **2/3 → 3/3** (+1).
- Lexical relationships: **5/22 → 6/22** (+1).
- Wordplay: **5/5 → 5/5**, translation: **21/22 → 21/22**, polysemy: **1/3 → 1/3**.
- Remaining real-world categories combined: 7/14 → **8/14**; **most of the original physical/process expectations are unassessable without explicit IDs/refs and the correct `bridge` mode**.

**Examples improved:** Genesis 1:1→John 1:1 **#14→#6**, 2 Kings 2:14→2 Kings 2:8 **#17→#1**, Isaiah 61:1→Luke 4:18 **absent→#2**, Zechariah 12:10→John 19:37 **absent→#9**, Psalm 16:10→Acts 2:27 **#20→#1**, Exodus 12:15→departure/wilderness narrative event **absent→#18**, Genesis 11:9 and other new scenes explored (quality below). Grounded lexical case Adam→adamah remains #1.

**Four recall regressions:** D016 Exodus 12:13 (expected related witness) **#10→#13**; D022 Exodus 25:31→Revelation 1:12 **#9→absent top-25**; D034 Psalm 69:21 **#10→#17**; S045 Exodus 19:18 **#7→#23**. The direct comparison tool can *still find* Exodus 25:31 ↔ Revelation 1:12 with an explicit xref and LXX bridge, which proves the underlying evidence is accessible, but it is missing from the unilateral passage discovery top-25.

### What is still missing

**36/186 assessable targets remain absent in the first 25**: L003, L005, L008, L053, L010, L011, L016, L035, L052, L034, L021, L024, L030, L032, S055, S027, D022, S002, S011, S014, S015, S017, S021, S020, S024, S039, S049, S052, S054, S056, S059, S063, W004, W008, W017, W030. **15** more are present after their K. Classify each as missing graph candidate, incorrect sense/alias resolution, ranking displacement, or incompatible bridge mode.

Particularly valuable missing connections:
- **H1818 blood ↔ H5315 life** (L003) absent from single-word top 25, but `get_Connection(["H1818","H5315"])` returns **28 shared verses**, including **Leviticus 17:11**, providing direct evidence. The discovery engine should surface this without the user having to supply both terms.
- **H0784 fire ↔ H6227 smoke** (W004) missing in single-word top 25; explicitly paired comparison returns 9 verse co-occurrences incl. Exodus 19:18, Genesis 15:17.
- **Genesis 1:26 ↔ Genesis 9:6** (D003) still #19, beyond K10; paired comparison immediately returns the direct xref and `H6754` *image* witness.
- **Genesis 11:9 Babel ↔ Acts 2:6 Pentecost languages** (S056) remains missing in unilateral discovery despite thematic importance; paired comparison did not reliably construct a cross-passage claim either.
- **2 Peter 1:19 ↔ Revelation 22:16 morning-star language** (S039) absent in unilateral discovery; paired comparison mainly returns unrelated neighbors of each input.
- **Genesis 1:3 ↔ Revelation 21:23** (S055) absent; compare route returns shared `God` plus Revelation-only neighbors instead of a coherent *light* motif.
- **Isaiah 11:2 ↔ Revelation 4:5** (S049) absent; paired comparison returns `ruach` ↔ `pneuma` but not a linked layered argument about Spirit/sevenfold imagery.

## 3. High-priority correctness defects found in NEW release

### P0-A — False named-entity bridge from Hebrew homograph (confirmed)

`get_Passage("Genesis 1:1", depth:25)` shows:
- `r12:entity:1:25369` — **"Pericope named-entity bridge: H4723 (Genesis 1:10) ↔ G5281 (Luke 8:15)"**; explanatory text asserts Genesis 1:10 has a *rare proper name H4723* linked via STEP/LXX lexical alignment to G5281.
- Actual `get_Passage("Genesis 1:10", depth:0)`: position 5 **`וּלְמִקְוֵה`**, H4723, **`lemma_key=lemma:H4723C`**, meaning **collecting place/gathering** ("the gathering together of the waters").
- Generic `get_Word("H4723")` defaults to separate homograph **H4723A**, `קֹוֶה`, **Kue**, a proper name. `get_Word("G5281")` = `ὑπομονή` **perseverance**. Neither is an actual proper-name equivalence in those two verses.
- This is a **wrong-lemma/sense contamination of a supposedly verified named-entity edge**, despite the earlier word-ID positional fix. Reject source entities where occurrence `lemma_key` + POS + verse alignments do not match the proposed entity type and target witness; require exact source-backed name bridge with same referent. Never join by Strong's alone.

### P0-B — `get_Connection.direct_link_found` false positives (confirmed interface defect)

`get_Connection({items:["H1904","H3629"],connections:25})` returns **`direct_link_found:true`**, even though **none of its 25 cards** refers to both queried lemma IDs. It instead merges Hagar-only and kidney-only neighbors. Likewise `Genesis 1:1` + `Obadiah 1:8` returned `true` with zero two-endpoint cards in top-25; same for `Genesis 11:9` + `Acts 2:6` and `2 Peter 1:19` + `Revelation 22:16`.

A boolean "direct link found" must depend on an actual verified pair **in the pair's own result/evidence graph**, not whether one or both items have any connections. Separate `shared_evidence`, `shared_candidate`, `individual_suggestions`, and `no_direct_connection`; ensure direct true implies an inspectable pair witness (potential later result need explicit pointer rather than unsupported true).

### P0-C / P1 — `research({operations:[{op:"evidence",evidence_id:...}]})` does not hydrate evidence

For `r12:scene:9566:24207` and `r11:xref:9566:9560`, the connected MCP returned `{status:"ok", evidence_id:"...", release_id:"r11-v1.0"}` **without original verses, mapped roles/lemmas, confidence limits, or a structured proof**. Similar empty status-only outputs occurred for eight R12 scene evidence IDs. Determine whether the transport wrapper intentionally strips evidence or the backend returns an empty payload; test the native route. Do not report a detailed evidence PASS until source, target, actual words/roles and limitations are inspectable.

### P1 — Structural "scene" candidates overreach semantic relevance

**Two clear examples verified by reading both original passages:**
- `Genesis 8:1` → `Acts 20:35` is **#2** (scene `r12:scene:185:27765`). Shared elements are *remember* and *work/labor*, but Genesis concerns God remembering Noah and the recession of flood waters; Acts concerns Paul's labor and recalling Jesus' teaching. This does **not** establish a common narrative scene.
- `Exodus 16:4` → `Matthew 19:3` is **#3** (scene `r12:scene:1952:23880`). *Test/tempt* and *law/lawful* resemble each other, but manna as a divine test and Pharisees testing Jesus about divorce are **different actions, agents, purposes and outcomes**. At most this is weak thematic/lexical overlap, not a verified literary scene.

Other high-rank candidates needing independent judgment include `2 Kings 2:14` → `Matthew 26:39` (#3 scene), `Exodus 12:13` → `Acts 22:20` (#2), `Isaiah 53:7` → `Matthew 5:2` (#4), and `Genesis 22:8` → `Romans 8:36` (#1). Many new candidates simply share 2 translated lemmas and at most 1 grammatical role. Calling all of them `shared_motif_evidence` Tier 4 is too strong for the most generic cases.

**Corrective rule:** First label them `candidate_lexical_scene_overlap` / exploratory until independent scene-level **actor/action/object/result**, event identity and semantic-role alignment are demonstrated. Weight *aligned role pairs* and contrast with negative controls; require more than raw shared words and a generic grammatical role. Separate *actual authorial quotation*, *editorial xref*, *structural scene correspondence*, and *lexical overlap*.

### P1 — False progression labeling

`r12:prog:276:274` is titled **"Same-chapter narrative progression: Genesis 11:9 → Genesis 11:7"** — **backwards in canonical reading order**. Likewise `2 Kings 2:14 → 2 Kings 2:13` is labeled progression. These may be useful **earlier context** pointers, but a reverse edge must be labeled `preceding_context`, not as forward chronology. Also check event chapter-fallback and chronology semantics before using progression for inference.

### P1 — Generic editorial xref dominance and weak low-rank numerics

`Genesis 1:1` ranks a reciprocal link to **Revelation 10:6** on generic "God" at #2 while the distinct **John 1:1 "in the beginning"** link is #6. Improve rare phrase, LXX identity, source-target topical support and independent source evidence. Avoid raising all reciprocal modern editorial links indiscriminately. `r11:xref` now dominates passage output.

`get_Word("three days resurrection")` begins with useful references to Matthew 12:40 / John 2:19 and Matthew 16:21, and no more Genesis 5:23 at top-10 (N009's stated forbidden window). However #21 and #25 call mere Genesis 5 *day/live* proximity "**three days** + **resurrection**", while #24 includes a broad `H7969` cluster referring to **Genesis 5:23**. These are lower-ranked semantic query expansion errors: *live* ≠ *resurrection*, and numeral "three" near dates/years ≠ "three days". Use typed duration/event predicates and governing concept coverage, not loose co-occurrence.

## 4. Known negative controls

Retested `get_Word` top-25 for **N001 Hagar→ostrich, N002 eye→angel, N003 logos→kidney, N004 covenant→wheel**: **all four absent**. That specific regression remains fixed.

N009's invalid Genesis 5:23 content remains outside disallowed top-10 but appears indirectly in positions 21–25. **Do not claim the full 24/24 controls pass** based on identifier searches alone.

## 5. Next engineering priorities (recommended order)

1. **P0 source parity + reproducibility:** save and review actual release-3 generator/ranker source in GitHub (do not overwrite authoritative local history); replace stale `R12_SOURCE_COMMIT` binding and pin `score_version`/asset hash. Run exact old discovery RPC benchmark on same build only once parity established; do not interpret the 169/215 old local experiment as live comparison.
2. **P0 provenance gate:** reject wrong-sense/wrong-POS entity and word edges (H4723C occurrence vs H4723A/Kue; G5281/perseverance); retain canary and throw/demote safely on ambiguity. Fix `direct_link_found` semantics and `research evidence` hydration.
3. **P1 scene precision:** audit a balanced sample of 30–50 of the 137 top-five scene cards with full original passages, actual source words and role alignment. Test false samples above. Downgrade shallow 2-word overlap, require independent scene-role structure, split correspondence vs mere similarity. **Do not maximize target@K by emitting misleading scene cards.**
4. **P1 recall for 36 missing:** prioritize single-anchor lexical co-occurrences present in the paired graph (H1818+H5315, H0784+H6227), then special missed pairs S055/S056/S039/S049. Inspect candidate generation budgets/shards before score tuning. Repair D022 regression (Exod 25:31→Rev 1:12) and keep 3 other known regressions in smoke test.
5. **P1 intent-aware reranking:** rerank candidate evidence by direct query anchor, actual independent source-target witness, rare original-language phrases, contrastive explanation, canonical scene relevance. Preserve lexical intent high precision; reduce generic editorial links and precomputed scene noise in passage queries. Use result-family diversity after relevance and validity.
6. **P2 mode parity and judgment metrics:** expose optional bridge/discover intent through new MCP or separate direct harness. Add strong lexical, physical, narrative, intertext, surprise-quality holdouts. Track *target recall, paired evidence precision, human-judged interestingness, unsupported claims, source accuracy, latency/asset reads, and holdout* separately. Low-tier subagents perform bounded ablations; orchestrator approves combined changes. No full benchmark after every small edit.

**Acceptance condition:** No known false named-entity conversions; `direct_link_found` reflects verifiable pair evidence; `research evidence` returns inspectable proof; sample scene precision improves; newly found valid intertexts remain in top-K; 24 neg controls verified; code in GitHub reproduces deployed Worker; no major resource or performance regression.

## Artifacts

- [Current machine-readable 239-case delta](EVALUATION_239.json) — exact prior/current rank per case and top-five family counts.
- [Current raw live top-25 outputs BATCH_01 through BATCH_14](.) — 190 query observations.
- [Previous live 22-Nov comparison ledger](../live_mcp_compat_retest_2026-11-22/COMPATIBILITY_EVALUATION_239.json).
- [Original frozen expectations](../R12_EXPECTED_CONNECTIONS_180_PLUS.json).

**Verdict:** **Substantial improvement in intertext and narrative retrieval**, but **not yet reliably accurate at proposing *new* semantic scene or named-entity relationships**. Fix evidence integrity and inspectability first, then re-evaluate novel connection relevance and optimize ranking.
