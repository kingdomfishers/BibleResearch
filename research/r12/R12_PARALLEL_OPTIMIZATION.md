# BibleResearch R12 — Parallel Iterative Algorithm Optimization Log

- **Started:** 2026-11-19
- **Authoritative Checkout:** `C:/Projects/BibleResearch-r10` on branch `feat/r12-qa-fixes` (synced to `origin/feat/r12-qa-fixes` commit `189df44`, preserving `scripts/verify-r10-browser.mjs` and untracked files)
- **Live Deployed Reference Baseline (`r12-discovery-2`, untouched during local rounds):** Corpus Worker `cce819e9-60d4-4e17-bb01-ed138af9a9a3`, Website `3d9482f4-7309-4fe5-babf-140041f5b42a`, Supabase `bible-mcp` v44 (`1.8.0`)
- **Evaluation Harness:** `scripts/eval-r12-optimization.mjs` (local `.artifacts-r12/staging-bundle` with `asset_reads`, `bytes_read`, `ms`, strict/range/paired screens, 24 negatives, P0/P1 quality canaries, and unseen prophetic scene probes)
- **Frozen Benchmark Source:** [R12_EXPECTED_CONNECTIONS_180_PLUS.json](R12_EXPECTED_CONNECTIONS_180_PLUS.json) (239 cases: 215 positive / 24 negative; unchanged)

---

## 1. Authoritative Round-0 Baseline

### 1.1 Independent Live `r12-discovery-2` Evaluation (`189df44` / `a349398`)

From [INDEPENDENT_LIVE_QUALITY_REPORT_2026-11-19.md](live_mcp_retest_2026-11-19_r12_discovery_2/INDEPENDENT_LIVE_QUALITY_REPORT_2026-11-19.md) and [R12_MCP_RETEST_ALL_239.json](live_mcp_retest_2026-11-19_r12_discovery_2/R12_MCP_RETEST_ALL_239.json):
- **Target@K (strict / range-aware):** `136/215` (63.3%) strict; `137/215` (63.7%) range-aware (up from `98/215` in `r12-discovery-1`)
- **After-K within top-25 / Absent in 25 / Paired@K:** `17/215` after-K; `61/215` absent in 25; `43/215` paired
- **Top-5 slot dominance (950 unique-query slots / 1,195 case-row slots):** `r11:gram` (336/385) + `r11:lxx` (329/376) = `70.0%` of unique-query top-5 slots; `r12:path` `111/200`; `r11:lex` `59/63`; `r11:xref` `35/39`
- **Confirmed quality/provenance defects (all reproduced locally below):** `P0-A` (Hagar `H5869` `"well"` mislabel on Gen 16:4 `"eyes"`), `P0-B` (`r11:lex:H7225:0` / `H0452:0` cross-language equivalents labeled `lexical_root_derivation` + Greek `language: "hbo"`), `P0-C` (Gen 1:1 `r11:gram:H1254` displaying `H1254c` `"to be fat / fatten"`), `P0-D` (OpenBible `r11:xref` labeled `"ancient editorial or intertextual connection"`), `P1-E` (`release_mismatch` ambiguity on `getConnectionEvidence`), plus unseen prophetic scene fragmentation (`Ezekiel 1 / Revelation 4`, `Revelation 13 / Daniel 7`)
- **Live availability note:** 7/190 initial HTTP 503s (`Q136–Q142`, recovered on retry) reported in live serial run (out-of-band Worker telemetry item tracked separately in `TASKS.md`).

### 1.2 Round-0 Unchanged Local Baseline (`.artifacts-r12/staging-bundle`)

- **239-Case Local Run (`--all-239`, 190 unique queries):**
  - `strict_top_k`: **136/215 (63.3%)** · `range_top_k`: **137/215 (63.7%)** · `in_top_25_after_k`: **17/215** (`in_top_25_any`: `154/215`) · `absent_in_25`: **61/215** · `paired_top_k`: **45/215** (`paired_in_25`: `57/215`)
  - Category strict/range-K/after-K/absent/paired: `linguistic_form` 5/5/0/0/0; `linguistic_lexical` 18/19/4/0/0 (23); `linguistic_polysemy` 5/5/0/0/0; `linguistic_translation` 21/21/1/0/0 (22); `direct_intertext` 25/25/6/24/23 (55); `narrative_chronology` 3/3/0/5/1 (8); `narrative_pattern` 27/27/4/23/21 (54); `narrative_genealogy` 0/0/1/2/0 (3); `real_world_material` 9/9/1/4/0 (14); `real_world_part_whole` 3/3/0/1/0 (4); `real_world_process` 11/11/0/1/0 (12); `real_world_property` 9/9/0/1/0 (10)
  - Top-5 slots (1,195 / 950): `r11:gram` 385/336, `r11:lxx` 376/329, `r12:path` 200/111, `r10:*` 107/59, `r11:lex` 63/59, `r11:xref` 39/35, `r11:intersect` 10/10, `r12:prop` 8/5, `r11:colloc` 4/4, `r11:cluster` 3/2
  - Latency & I/O: `total_ms=7639.05`, `median=38.80ms`, `p95=86.39ms`, `max=148.99ms`; `total_asset_reads=2499` (median `17`, max `34`), `total_bytes_read=172,218,574` (`restricted_keys=0`, `missing_assets=0`)
- **20 Tuning Cases Baseline (`--cases`):** `strict_top_k=4/16`, `range_top_k=4/16`, `after_k=7/16`, `absent_25=5/16`, `paired_top_k=2/16`, `negatives=3/4` (`N009` FAIL), `median=45.10ms`, `max=256.44ms`, `asset_reads=237` (median `15`, max `34`)
- **Negatives (`--negatives`, 24 controls):** **23/24 PASS** (`N009` FAIL: `any_top4_covers_resurrection=false`; `N001–N004` impossible targets `0`; `r12:path` `documented_lexical_relationship=0`; synthetic predicates `0`; restricted keys `0`)
- **Quality Canaries (`--quality-canaries`):** **0/5 PASS** (`P0-A` FAIL, `P0-B` FAIL, `P0-C` FAIL, `P0-D` FAIL, `P1-E` FAIL). Unseen scene cross-book alignment in top-10: `Ezekiel 1 / Revelation 4` **false** (#24), `Zechariah 4 / Revelation 11` **true** (#1/#10), `Revelation 13 / Daniel 7` **false** (#18/#23/#25).
- **Frozen 15-Case Holdout (`--holdout`, aggregate only — uninspected during tuning):** `strict_top_k=0/13`, `range_top_k=0/13`, `after_k=7/13`, `absent_25=6/13`, `paired_top_k=0/13` (`paired_in_25=4/13`), `negatives=2/2`, `median=46.72ms`, `p95/max=158.84ms`, `asset_reads=201` (median `17`, max `20`), `bytes=14,179,262` (`restricted_keys=0`).

---

## 2. Case Sets & Frozen Holdout Partition

- **Frozen Holdout (15 cases, untouched until Final Validation):** `D004`, `D047`, `D035`, `D043`, `S008`, `S019`, `S015`, `S029`, `S060`, `L003`, `L054`, `W015`, `W026`, `N021`, `N024`.
- **Round 1 (Passage Relevance, Xrefs & P0-B/C/D Provenance):** `D001`, `S009`, `D029`, `S018` (guard), `N010` + `P0-B/C/D`.
- **Round 2 (Multi-Concept Governing Coverage, Sense-Aware Claims P0-A & Bridge Mode):** `W024`, `W014`, `S035`, `L001` (guard), `N009` + `P0-A`.
- **Round 3 (Pericope/Event Span Routing & Editorial Xref Relevance):** `S006`, `S001`, `D017`, `D027` (guard), `N011` (`+ N001–N004`).
- **Round 4 (Lexical/Genealogy Ranking, Mechanism Diversity & Evidence Release Contract P1-E):** `L008`, `L022`, `S031`, `L044` (guard), `N004` (`+ N001–N024`, unseen scenes).

---

## 3. Iterative Optimization Log

### Round 1 — Passage-Seed Relevance, Anchored Xrefs & Evidence Provenance (`P0-B/C/D`)
**Cases:** `D001` (`Genesis 1:1`, K=10), `S009` (`2 Kings 2:14`, K=12), `D029` (`Deuteronomy 8:3`, K=10), `S018` (`Hosea 6:2`, K=25 guard), `N010` (`Hosea 6:2` control), plus `P0-B`, `P0-C`, `P0-D` quality canaries.

#### Experiment 1B (`r10-types.ts`, `r10-discovery.ts`) — Shared Provenance Builders & `editorial_cross_reference` Tier 4 (**ACCEPTED**, paired with 1A)
- **Changes:** Added `'editorial_cross_reference'` to `R10EpistemicClass` (`r10-types.ts`); extracted `buildLexicalRelationRecord` fixing Strong's-prefix `language` (`grc`/`hbo`), parsing `lrel.label` + hydrating target profiles in `getConnectionEvidence`, eliminating `"undefined"` on `formation_*`, and separating `source_provided_lexical_equivalent` / `cross_language_name_transcription` / `lexical_formation_analysis` from `lexical_root_derivation`; extracted `buildXrefRecord` moving `r11:xref` from Tier 2/3 (`verified_cross_reference`, `strong_correspondence`, `"ancient editorial..."`) to Tier 4 `editorial_cross_reference` (`835`/`785`/`750`/`700`).
- **1B-Alone Metrics:** `P0-B` FAIL -> **PASS** (`0` `hbo`-on-Greek errors), `P0-D` FAIL -> **PASS**, `check:types` PASS, `--negatives` `23/24`, `verify-r12-algorithm-v2` PASS. Expected temporary demotion of `r11:xref`: `D001` (`@20 -> ABSENT_25`), `S009` (`@14 -> @21`), `D029` (`@14 -> @24`), `S018` (`@4 -> @10`).

#### Experiment 1A (`r10-discovery.ts` on top of 1B) — Passage-Query Intent Framing, E2 Xref Rerank & `P0-C` Sense Disambiguation (**ACCEPTED**)
- **Changes:** Fixed `MACULA_FUNC_CLASSES` short POS filtering (`cj`/`prep`/`ptcl`/`adv`/`rel`/`om`/`intj`/`pron`/`det`) and raised passage-query `profileSliceLimit` to `14` (budget-guarded); defined `isPassageOnlyQuery = explicitPassages.length > 0 && stage1Terms.length === 0` gating `explicit-and-typology` against coincidental hub-only `passageOverlap === 0` matches (`-280` background penalty) and demoting non-witness/background `r11:gram` (`-195`), `r11:lxx`/`r11:lex`/`r11:cluster`/`r11:colloc`/cluster-`r11:xref`/non-witness-`r12:*` (`-190`); expanded E2 `r11:xref` fetch to `16` within budget `45` and added bounded IDF-weighted shared-content + LXX-bridge overlap bonus (capped at `875`, preserving Tier 4 `editorial_cross_reference`); balanced `isPassageOnlyQuery` diversification (`r11:xref:seed` `grace=5, pen=25`, `r12:path`/`r11:gram`/`r11:lxx` `grace=2, pen=55`); added `resolveDisplaySense` over same-Strong's `homograph_siblings` across `r11:gram` & single-lemma cards (`P0-C`).
- **1A+1B Cumulative Metrics vs Round-0 Local Baseline:**
  - `D001` (`Genesis 1:1`, K=10): `MISS (AFTER_K@20)` (15 reads) -> **`PASS@8`** (strict/range/paired, 27 reads, 261.8 ms)
  - `S009` (`2 Kings 2:14`, K=12): `MISS (AFTER_K@14)` (16 reads) -> **`PASS@3`** (strict/range/paired, 28 reads, 123.8 ms)
  - `D029` (`Deuteronomy 8:3`, K=10): `MISS (AFTER_K@14)` (20 reads) -> **`PASS@5`** (strict/range/paired, 35 reads, 163.2 ms)
  - `S018` (`Hosea 6:2`, K=25 guard): `PASS@4` -> **`PASS@1`** (`r11:xref:22286:28823`, 25 reads, 133.0 ms)
  - `N010` (`Hosea 6:2` control): `PASS` -> **`PASS`**
  - Quality canaries: `P0-B` **PASS**, `P0-C` **PASS** (`lemma:H1254a` `"to create"`), `P0-D` **PASS** (`3/5` total vs `0/5` baseline).
  - Negatives & Regressions: `--negatives` `23/24` (`0` `N001–N004`, `0` restricted keys, `max_asset_reads=35`), `check:types` PASS, `verify-r12-smoke` 5/5 PASS, `verify-r11-discovery` 14/14 PASS, `verify-r12-algorithm-v2` `ALL_V2_ALGORITHM_CHECKS_PASSED`.

---

---

### Round 2 — Multi-Concept Governing Coverage, Sense-Aware Claims (`P0-A`), Pericope Context & Bridge Mode
**Cases:** `W024` (`"vine"`, bridge, K=25), `W014` (`"H5178"`, bridge, K=12), `S035` (`"Zechariah 4:6"`, discover, K=25), `L001` (`"H0120"`, discover, K=15 guard), `N009` (`"three days resurrection"`), plus `P0-A` and 16 non-holdout `W*` bridge spot-checks.

#### Experiment 2A (`r10-discovery.ts`) — Multi-Concept Governing Coverage & Occurrence-Sense Verification (**ACCEPTED**, paired with 2B)
- **Changes:** Added `verifyTermSenseInVerse` (`sameStrongsSiblings.length > 0` gated so translational ranges like `H7307` are preserved; checks `occStems` from verse token glosses `t.g` and `resolveDisplaySense` on `r11:intersect:verse` and `r11:intersect:pericope` with `needToks`); deduplicated phrase numerals (`SMALL_NUMERAL_STRONGS` / `explicitNumberStrongsStage15`) and unattested (`cnt === 0`) shard noise, sorting `cnt >= 5` ahead of `cnt < 5` and raising `profileSliceLimit` to `min(8, concepts * 3)` for `>= 3` concepts; required `meaningful_subset` to cover `governingGroups` (rarest non-numeric concepts) before `familyCounts` grace penalties run; calibrated `r11:intersect:verse` IDF and capped `sameLemmaOnly` (`pA.bs === pB.bs`) inspection at `3` verses.
- **2A-Alone Metrics:** `N009` FAIL -> **PASS** (`reads=34`, `all_top4_cover_resurrection=true`, Matt 27:63 / John 2:19-20 `all_concepts`); `--negatives` **24/24 PASS**; `P0-A` FAIL -> **PASS** (`reads=42`, `0` `budget:*` misses, Gen 16:4 `"hagar" + "eyes"` `#1`, `says_well=false`); quality canaries **4/5 PASS** (`P0-A/B/C/D`); Round 1 (`D001@8`, `S009@3`, `D029@5`, `S018@1`, `N010` PASS) and `L001@1` preserved; `check:types`, `verify-r12-smoke` (5/5), `verify-r11-discovery` (14/14), `verify-r12-algorithm-v2` PASS.

#### Experiment 2B (`r10-discovery.ts`, isolated on top of Round 1) — `bridge` Calibration, Gloss Priority, Cluster Relaxation & `±4` Pericope Context (**ACCEPTED**)
- **Changes:** In `mode === 'bridge'`, zeroed boost on empty-passage (`passages=[]`) and query-internal synonym `r11:lxx`, capped remaining witness-bearing `r11:lxx` boost at `+50` (`grace=1`), reduced cross-testament `r12:path` boost `+130 -> +45` with per-anchor `bridge` grace (`2` per anchor when `r12AnchorsMatched.length > 1`, else `3`), raised `takeRecs` to `12`, relaxed `r11:cluster` penalty `-130 -> -45`, scored `r12PropertyBridgeToRecord` `external_concept_equivalence` cleanly above weak shared properties, prioritized attested gloss hits in Stage 1 (`cnt > 0 && match_rank >= 85` + missing-language fallback) with bounded `idfBonus`, expanded `D2` collocations across top clusters (`sample_passages.slice(0, 6)`), and added `0`-extra-read `±4` same-chapter pericope context (cached chunks only) + `isMismatchedPassageHomograph` guard on `isPassageOnlyQuery`.
- **2B-Alone Metrics:** `W024` `ABSENT_25` -> **`PASS@21`** (`reads=7`); `W014` `AFTER_K@15` -> **`PASS@6`** (`reads=4`); `S035` `ABSENT_25` -> **`PASS@15`** (`reads=31`, `#2 Rev 5:6`, `#15 Rev 4:5`); `L001` **`PASS@1`** (`reads=4`); Round 1 (`D001@8`, `S009@3`, `D029@5`, `S018@1`, `N010` PASS) preserved; 16 non-holdout `W*` bridge spot-checks **16/16 strict/range@K** (`max_asset_reads=28`); `Revelation 13 <-> Daniel 7` `false (#16)` -> **`true (#9)`** (`reads=32`); `check:types` and verification scripts PASS.

#### Combined Round 2 (2A + 2B Merged, **ACCEPTED**) vs Round 1
- **Rounds 1–2 Target Cases (`8/8` positive `strict_top_k=true`, `2/2` negative `pass=true`, `paired_top_k=4`, `max_asset_reads=38`, `unique_missing_assets=[]`, `restricted_keys_total=0`):**
  - `D001` `@8` (`reads=29`), `S009` `@3` (`reads=31`), `D029` `@5` (`reads=38`), `S018` `@1` (`reads=28`), `N010` `PASS` (`reads=28`)
  - `W024` `ABSENT_25` -> **`PASS@21`** (`reads=7`) · `W014` `AFTER_K@15` -> **`PASS@6`** (`reads=4`) · `S035` `ABSENT_25` -> **`PASS@15`** (`reads=31`) · `L001` **`PASS@1`** (`reads=4`) · `N009` FAIL -> **`PASS`** (`reads=34`)
- **Non-holdout `W*` spot-check (16 cases):** **`16/16` (`100%`) `strict_top_k=true`** (`max_asset_reads=28`, `0` missing assets).
- **Negatives (`--negatives`):** **`24/24` PASS** (`max_asset_reads=36`, `median=4`, `0` restricted keys).
- **Quality Canaries & Unseen Scenes:** **4/5 PASS** (`P0-A`, `P0-B`, `P0-C`, `P0-D`; `P1-E` scheduled for Round 4); unseen scenes **3/3 `cross_book_alignment_in_top10=true`** (`Ezekiel 1 <-> Rev 4` `#4`, `Zech 4 <-> Rev 11` `#1/#10/#14`, `Rev 13 <-> Dan 7` `#9/#10/#13/#18`).
- **Regressions:** `check:types` PASS, `verify-r12-smoke` 5/5 PASS, `verify-r11-discovery` 14/14 PASS, `verify-r12-algorithm-v2` `ALL_V2_ALGORITHM_CHECKS_PASSED`.

---

### Round 3 — Pericope/Event Span Routing, `events_b64gz` Verification (`event:74`) & Editorial Xref Rebalance
**Cases:** `S006` (`"Exodus 14:30"`, discover, K=15), `S001` (`"Exodus 12:15"`, discover, K=25), `D017` (`"Exodus 12:22"`, discover, K=15 guard), `D027` (`"Deuteronomy 6:4"`, discover, K=10 guard), `N011` (`"Exodus 12:15"` chronology control), plus `N001–N024` and Rounds 1–2 guards.

#### Experiment 3A (`r10-discovery.ts`) — Cached `±12` Pericope Expansion, 1-Chunk Boundary Read & Same-Book `r12:event` Span (**ACCEPTED**, paired with 3B)
- **Changes:** Stored `chapter_vids` in `bookChapterVids`; widened cached same-chapter `pericopeNeighbors` (`±4 -> ±12`, `0` extra reads on cached chunks) plus max-1-chunk boundary read for `dist <= 4` (`budget.used < budget.max - 10`, bringing `Exod 14:31` into view on `Exod 14:30`); extended `r12:event` with 1 already-loaded same-book `evInfo.sample_vids` witness and 1 `event_by_chapter` uncovered same-book chapter witness (peak reciprocal-xref verse, honest canonical narrative sequence framing, max 1 chunk read).
- **3A-Alone Metrics:** `S006` `ABSENT_25` -> **`PASS@1`** (`r10:typo:1cor10_1_2_red_sea_baptism` `1100`, `reads=32`); `S001` `ABSENT_25` -> **`PASS@6`** (`r12:event:1832:event:125` `[Exod 12:15, Exod 12:39, Exod 13:18, Exod 14:21]`, `reads=35`); Rounds 1–3 positives **12/12 strict/range@K**, `N011` PASS, `--negatives` **24/24 PASS**, canaries 4/5 + 3/3 unseen scenes, `check:types` + smoke + discovery + v2 PASS.

#### Experiment 3B (`r10-discovery.ts`, isolated on top of Round 2) — `events_b64gz` Multi-Book Suppression, Tier 4 Event Reclassification & Passage `r11:xref`/`r11:gram` Rebalance (**ACCEPTED**)
- **Changes:** Decoded `events_b64gz` once per run (`ensureEventsMap`) in both discovery and `getConnectionEvidence`; suppressed `!isExactMatch` multi-book retrospective chapter-fallback spans (eliminating `event:74` on `Exod 12:15`/`12:22`); reclassified `r12:event` from Tier 3 `direct_textual_evidence` (`885`) via shared `buildEventRecord` to Tier 4 `shared_motif_evidence` (`confidence_label: 'candidate_pattern'`, `820` exact / `805` chapter-level, `grace=1`); lifted `buildXrefRecord` cap `875 -> 915` on corroborated OT↔NT xrefs; deduplicated symmetric passage `r11:gram` (`grace=1`, damped `-75` capped `<= 850`); added `pn.dist <= 2` non-reciprocal OT↔NT fallback (`backgroundPenalty=105`) in `neighborXrefCands`.
- **3B-Alone Metrics:** `has_event_74=false` on `Exod 12:15` & `12:22`; major rank improvements: `D001` `8 -> 6`, `S009` `3 -> 1`, `D029` `5 -> 1`, `D017` `8 -> 4`, `S035` `15 -> 14`; Rounds 1–2 (`8/8`), `D017`/`D027`, `--negatives` **24/24 PASS**, canaries 4/5 + 3/3 unseen scenes, `check:types` + smoke + discovery + v2 PASS.

#### Combined Round 3 (3A + 3B Merged, **ACCEPTED**) vs Round 2
- **Rounds 1–3 Target Cases (`12/12` positive `strict_top_k=true` & `range_top_k=true`, `7/7` `paired_top_k`, `3/3` case negatives PASS, `max_asset_reads=38`, `unique_missing_assets=[]`, `restricted_keys_total=0`):**
  - `S006` (`Exod 14:30`, K=15): `ABSENT_25` -> **`PASS@1`** (`r10:typo:1cor10_1_2_red_sea_baptism`, score `1100`)
  - `S001` (`Exod 12:15`, K=25): `ABSENT_25` -> **`PASS@14`** (`r12:event:1832:event:125`, `805`, Tier 4 `shared_motif_evidence`, `[Exod 12:15, Exod 12:39, Exod 13:18, Exod 14:21]`; `has_event_74=false`)
  - `D017` (`Exod 12:22`, K=15 guard): `@8` -> **`PASS@4`** (`has_event_74=false`) · `D027` (`Deut 6:4`, K=10 guard): **`PASS@1`** · `N011` (`Exod 12:15` control): **`PASS`**
  - Round 1–2 gains preserved/improved: `D001` **`@6`**, `S009` **`@1`**, `D029` **`@1`**, `S018` **`@1`**, `W014` **`@6`**, `W024` **`@21`**, `S035` **`@14`**, `L001` **`@1`**, `N009`/`N010` **`PASS`**.
- **Negatives (`--negatives`):** **`24/24` PASS** (`max_asset_reads=38`, `median=4`, `0` restricted keys).
- **Quality Canaries & Unseen Scenes:** **4/5 PASS** (`P0-A/B/C/D`; `P1-E` next in Round 4), unseen scenes **3/3 `cross_book_alignment_in_top10=true`** (`Ezekiel 1 <-> Rev 4` `[4]`, `Zech 4 <-> Rev 11` `[1,10,14]`, `Rev 13 <-> Dan 7` `[9,10,13,18]`).
- **Regressions:** `check:types` PASS, `verify-r12-smoke` 5/5 PASS, `verify-r11-discovery` 14/14 PASS, `verify-r12-algorithm-v2` `ALL_V2_ALGORITHM_CHECKS_PASSED`.

---

### Round 4 — Lexical/Genealogy Mechanism Diversity, Budget Cleanup & `P1-E` Provenance Contract
**Cases:** `L008` (`"H1285"`, discover, K=15), `L022` (`"H3899"`, discover, K=12), `S031` (`"Genesis 38:30"`, discover, K=15), `L044` (`"H7225"`, discover, K=10 guard), `N004` (`"H1285"` wheel control), plus `P1-E`, 16 non-holdout `W*` cases, and 3 unseen dual-passage scenes.

#### Experiment 4A (`r10-types.ts`, `r10-discovery.ts`, `supabase/functions/bible-mcp/relationships-v2.ts`) — `P1-E` Explicit `evidence_release_id` & Structured `release_mismatch` (**ACCEPTED**, paired with 4B)
- **Changes:** Added optional `evidence_release_id` across `R10ConnectionSummary`, `DiscoverConnectionsResult`, `DiscoverConnectionsResult['r12_discovery']`, `ConnectionEvidenceResult`, and `ExpandConnectionResult` (preserving `release_id: 'r11-v1.0'` and `r12_discovery.release_id: 'r12-discovery-2'`). Extended `ConnectionEvidenceResult['status']` with `'release_mismatch'` plus `requested_release_id`, `corpus_release_id`, `error`, and structured `mismatch` metadata (`corpus_overlay_release_id_passed` vs `unsupported_evidence_release_id`). In `getConnectionEvidence`, when `releaseId !== DEFAULT_R10_RELEASE` lacks both `fast-manifest.json.gz` and `explicit-and-typology.json.gz`, probes `DEFAULT_R10_RELEASE` via an isolated `probeBudget` (`(probeBudget.missing?.length ?? 0) === 0`) without altering `budget.pages` map keys — preserving legacy `r10-v1.0`, synthetic fixtures, and real `missingReader` outages (`missing_source_coverage`). Clarified `release_id` parameter documentation on `get_connection_evidence_v1`.
- **4A-Alone Metrics:** `check:types` PASS; `--quality-canaries` **5/5 PASS (`P0-A..D` + `P1-E`)**; 3/3 unseen scenes `top10=true`; `verify-r12-smoke` (5/5), `verify-r11-discovery` (14/14), `verify-r12-algorithm-v2` PASS; `verify-r12-reliability` exports cleanly (`ALL_EDGE_CASES_PASSED` on outage/mismatch probe). Note: pre-existing `verify-r12-worker --mode self-test` blocks at `scripts/verify-r12-worker.mjs:386` (`trace.cache_hits >= 6`, unrelated to 4A).

#### Experiment 4B (`r10-discovery.ts`, isolated on top of Round 3) — Mechanism Diversity, `DIRECT_ENDPOINT_WITNESS` Calibration & Unseen-Scene Budget Cleanup (**ACCEPTED**)
- **Changes:** Removed the 5/5 `r12:path` `grace=5` monopoly in non-`bridge` `discover` mode by splitting `r12:path` into `r12:path:same` (`grace=2`) and cross-language `r12:path:xlang` (`grace=1`, `stepPen=30`); set `r12:path` `grace=1` in `isPassageOnlyQuery`; calibrated `DIRECT_ENDPOINT_WITNESS` base `780 -> 720` in `r12MultihopRecToRecord`; skipped extra `orthographic/shard-*` fallback reads when `fastManifest.direct_b64gz` is true; bounded `r12_pilot_embedded` fallback reads to `allowedExtraPilotKeys` + `budget.used < budget.max - 4`.
- **4B-Alone Metrics:** **20/20** tuning cases PASS (`L008` `ABSENT_25 -> PASS@6`, `L022` `@6 -> PASS@1`, `S031` `@11 -> PASS@9`, `L044` `PASS@3` preserved, `N004` PASS); **16/16** non-holdout `W*` `strict_top_k=true`; `--negatives` **24/24 PASS**; unseen scenes **3/3 `top10=true`** with reads reduced `45 -> 39` (`Ezekiel 1/Rev 4`), `45 -> 40` (`Zech 4/Rev 11`), `33 -> 28` (`Rev 13/Dan 7`, ranks `[9,10,13,18] -> [8,9,12,15]`); `check:types`, smoke, discovery, v2 all PASS.

#### Combined Round 4 (4A + 4B Merged, **ACCEPTED**)
- **20 Tuning Cases (Rounds 1–4):** **`16/16` (`100%`)** positive `strict_top_k=true` & `range_top_k=true`, **`8/8`** `paired_top_k`, **`4/4`** negatives PASS (`D001@6`, `S009@1`, `D029@1`, `S018@1`, `W024@19`, `W014@4`, `S035@14`, `L001@1`, `S006@1`, `S001@12`, `D017@4`, `D027@1`, `L008@6`, `L022@1`, `S031@9`, `L044@3`; `max_asset_reads=38`, `median=28`, `0` missing assets, `0` restricted keys).
- **Non-holdout `W*` (16 cases):** **`16/16` `strict_top_k=true`**.
- **Negatives, Canaries & Unseen Scenes:** **`24/24`** `--negatives` PASS; **`5/5`** canaries PASS (`P0-A/B/C/D`, `P1-E`); **`3/3`** unseen scenes `top10=true` with **`0` `budget:*` misses**.

---

## 4. Final Frozen Validation Summary (`.artifacts-r12/staging-bundle`)

Algorithm code was frozen prior to running `--holdout` and `--all-239`.

### 4.1 Before vs. After Benchmark Comparison

| Suite / Metric | Round-0 Local Baseline | Frozen Round 4 Final | Delta |
|---|---:|---:|---:|
| **20 Tuning Cases** (`strict / range / paired / neg`) | `4/16 / 4/16 / 2/16 / 3/4` | **`16/16 / 16/16 / 8/16 / 4/4`** | `+12` pos, `+6` paired, `+1` neg |
| **15 Frozen Holdout** (`strict / range / paired / neg`) | `0/13 / 0/13 / 0/13 / 2/2` | **`7/13 (53.8%) / 7/13 (53.8%) / 6/13 / 2/2`** | `+7` pos (`8/13` in 25), `+6` paired |
| **Full 239: `strict_top_k`** (`215` positives) | `136/215 (63.3%)` | **`169/215 (78.6%)`** | **`+33` (+15.3 pts)** |
| **Full 239: `range_top_k`** (`215` positives) | `137/215 (63.7%)` | **`170/215 (79.1%)`** | **`+33` (+15.4 pts)** |
| **Full 239: `in_top_25_any` / `absent_in_25`** | `154 / 61` | **`180 / 35`** | **`+26` surfaced / `-26` absent** |
| **Full 239: `paired_top_k` / `paired_in_25`** | `45 / 57` | **`77 / 84`** | **`+32` paired (+71.1% rel.)** |
| **Negative Controls (`--negatives`, 24)** | `23/24` (`N009` FAIL) | **`24/24` (`100%`)** | **`N009` fixed** |
| **Quality Canaries (`P0-A..D`, `P1-E`)** | `0/5` | **`5/5` (`100%`)** | **`+5/5` all fixed** |
| **Unseen Prophetic Scenes (`top10`)** | `1/3` (`#24, #1, #18`) | **`3/3` (`#4, #1, #8`)** | **`+2/3` (`39, 40, 28` reads, 0 misses)** |
| **Security / Integrity (`restricted_keys`, `no_match`, `missing`)** | `0 / 0 / 0` | **`0 / 0 / 0`** | Clean (`0` regressions) |
| **Full 239 I/O (`median_ms` / `p95_ms` / `max_ms`)** | `38.80 / 86.39 / 148.99` | `61.64 / 143.15 / 204.03` | `+22.8 ms` median (`total 11.43s`) |
| **Full 239 Reads (`total` / `median` / `max`)** | `2499 / 17 / 34` | `3919 / 25 / 39` | Max `39 <= 45` budget |
| **Full 239 Bytes Read (`total` / `median` / `max`)** | `172.2 MB / - / -` | `265.8 MB / 1.65 MB / 2.87 MB` | Bounded per query |

### 4.2 Full 239 Category Breakdown & Top-5 Diversity Shift

- **Per-category `strict / range / after-K / absent / paired` (Baseline -> Final):**
  - `linguistic_form` (5): `5/5/0/0/0` -> **`5/5/0/0/0`**
  - `linguistic_lexical` (23): `18/19/4/0/0` -> **`21/22/1/0/0`** (`+3`)
  - `linguistic_polysemy` (5): `5/5/0/0/0` -> **`5/5/0/0/0`**
  - `linguistic_translation` (22): `21/21/1/0/0` -> **`22/22/0/0/0`** (`100%`)
  - `direct_intertext` (55): `25/25/6/24/23` -> **`43/43/5/7/41`** (`+18` strict, `+18` paired, `-17` absent)
  - `narrative_chronology` (8): `3/3/0/5/1` -> **`4/4/1/3/3`** (`+1` strict, `+2` paired)
  - `narrative_pattern` (54): `27/27/4/23/21` -> **`33/33/2/19/29`** (`+6` strict, `+8` paired)
  - `narrative_genealogy` (3): `0/0/1/2/0` -> **`2/2/0/1/2`** (`+2` strict, `+2` paired)
  - `real_world_material` (14): `9/9/1/4/0` -> **`11/11/0/3/1`** (`+2`)
  - `real_world_part_whole` (4): `3/3/0/1/0` -> **`4/4/0/0/1`** (`100%`)
  - `real_world_process` (12): `11/11/0/1/0` -> **`10/10/1/1/0`** (`-1`, moved just after K into top-25)
  - `real_world_property` (10): `9/9/0/1/0` -> **`9/9/0/1/0`**
- **Top-5 Unique-Query Slot Distribution (`950` slots, Baseline -> Final):**
  - `r11:gram` (`336 -> 174`) + `r11:lxx` (`329 -> 80`) dropped from **`70.0%` (`665/950`) to `26.7%` (`254/950`)**
  - `r11:xref` **`35 -> 421`** · `r10:*` **`59 -> 72`** · `r12:path` **`111 -> 70`** · `r11:cluster` **`2 -> 47`** · `r12:prop` **`5 -> 42`** · `r12:event` **`0 -> 19`** · `r11:lex` **`59 -> 8`** · `r11:intersect` **`10 -> 7`** · `r12:orth` **`0 -> 6`** · `r11:colloc` **`4 -> 4`**.
- **Frozen Holdout Details (`--holdout --verbose-holdout`, 15 cases):**
  - `D004 @3`, `D047 @1`, `D043 @6`, `S019 @1`, `S029 @5`, `S060 @1`, `L054 @15 (K=20)` — all `7` PASS; `L003 @15 (K=10)` after-K; `D035, S008, S015, W015, W026` `absent_25`; `N021, N024` `2/2` PASS.

### 4.3 Frozen Validation Check Matrix

| Command | Result | Notes |
|---|---|---|
| `npm.cmd run check:types` | **PASS** (`exit 0`) | Zero TypeScript errors |
| `npm.cmd run build` | **PASS** (`exit 0`) | `vite build` 104 modules (`822 ms`) |
| `node --test research/r12/*.test.mjs` | **PASS** (`4/4` files) | Orthographic, proof-ranker, property-bridges, structural-candidates |
| `node scripts/verify-r12-smoke.mjs` | **PASS** (`exit 0`) | 5/5 R12 smoke assertions |
| `node scripts/verify-r12-packed-loading.mjs` | **PASS** (`exit 0`) | Packed range/gzip/cache invariants |
| `node scripts/verify-r11-discovery.mjs` | **PASS** (`exit 0`) | 14/14 R11 regressions |
| `node scripts/verify-r11-benchmark.mjs` | **PASS** (`exit 0`) | All checked lemmas `recall: 1`, `unsupported: 0` |
| `node scripts/verify-r12-algorithm-v2.mjs` | **PASS** (`exit 0`) | `ALL_V2_ALGORITHM_CHECKS_PASSED` |
| `node scripts/verify-r12-reliability.mjs` | **PASS** (`exit 0`) | Exports intact; outage/mismatch probe verified separately |
| `node scripts/verify-r12-worker.mjs --mode self-test` | **BLOCKED (`exit 1`)** | Pre-existing `verify-r12-worker.mjs:386` `assert.ok(trace.cache_hits >= 6)` on `zzr12fixture` (unrelated to runtime edits) |

### 4.4 Confirmed Offline-Bundle Gaps (Require Future Asset Rebuild, Not Runtime Workarounds)
1. **Event passage truncation & chapter fallback (`scripts/build-r10-discovery-index.mjs:1565` `.slice(0, 12)` & `scripts/pack-r12-cpu-safe-assets.mjs:1033–1038` `eventsByChapter`):** `78.3%` (`10,405/13,284`) of chunk event tags are chapter-fallbacks (suppressed cleanly at runtime when multi-book/cross-book, e.g. `event:74`), while long events (`event:126`) truncate before `Exod 14:21`.
2. **Missing `sample_refs` on `bcv_lxx_bridge` (`H3899->G0740`, `L022` paired):** `r12:prop` uses `all_vids.slice(0, 2)` (`Gen 3:19`, `14:18`), leaving `Deut 8:3` unattached for paired citation without an offline profile/LXX witness backfill.
3. **Missing LXX edge on `H2226` (`S031`) & non-reciprocal bit on `Exod 12:15 -> Exod 14:21` / `1150 -> 23264`:** Clean runtime heuristics compensate (`S031 @9`), but richer cross-testament lexical/witness attachments belong in the next bundle repack.
4. **Residual 35 `absent_in_25` benchmark cases (and 5 `absent_in_25` holdout cases such as `D035`, `S008`, `S015`, `W015`, `W026`):** Remaining misses involve deeper cross-pericope or unindexed narrative/process links requiring offline graph/pilot/LXX enrichment.
