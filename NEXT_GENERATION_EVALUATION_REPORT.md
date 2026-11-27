# BibleResearch v3 — Next-Generation Discovery Intelligence Evaluation Report

## 1. Executive Summary

BibleResearch v3 delivers a unified, cross-lingual, multi-axis biblical discovery architecture spanning offline corpus compilers (`scripts/v3/`), binary & conductance-graph runtime engines (`src/relationships/v3-*.ts`), Cloudflare Corpus Worker RPCs (`scripts/corpus-relationships-rpc.mjs`, `scripts/corpus-worker.mjs`), progressive MCP tooling (`supabase/functions/bible-mcp/`), and interactive Website UI panels (`src/ui/components/`).

On the **3-arm blind scholarly evaluation** across `B1`–`B6` and frozen holdout `H1`–`H3` (`N=9`, 27 anonymized reports, `0` residual identity leaks):
- **Overall Mean (`0–10`):** **`v3` `9.18`** (`6/9` Rank #1 wins, #1 across every rubric dimension) vs **`Live v2` `8.73`** (`3/9` wins) vs **`No-MCP` `7.95`** (`0/9` wins).
- **Frozen Holdout (`H1`–`H3`, `N=3`):** **`v3` `9.44`** (**`3/3` clean sweep** across all 6 rubric dimensions) vs **`No-MCP` `8.61`** (`0/3`) vs **`Live v2` `7.94`** (`0/3`).
- **MCP Wire Efficiency (`9` tasks):** **`1,735.0 KB/task` (`v2`) → `604.7 KB/task` (`v3`, `-65.1%`)** with `0` duplicate calls.
- **Negative & Safety Gates:** **`50/50 PASS`** on [eval-adversarial-50.mjs](research/v3/eval-adversarial-50.mjs), **`32/32 PASS`** on [eval-r13-discovery.mjs](scripts/eval-r13-discovery.mjs) (`MRR: 0.9712`, `NDCG@10: 0.9781`), **`PASS`** on [verify-corpus-security.mjs](scripts/verify-corpus-security.mjs) (`0` restricted UBS keys, zero Swete BY-SA in `v3/`), and **`0` HTTP `1102`** in local `workerd` stress testing.

*(Per user approval to prioritize live ChatGPT testing, frozen holdout `H4`–`H6` MCP runs were deferred to interactive testing in ChatGPT after deployment; `No-MCP H4–H6` reports remain preserved in `research/v3/eval-final/`.)*

---

## 2. Implemented Architecture (`S0`–`S5`) & Gates (`G0`–`G6`)

| Stage / Gate | Delivered Capabilities | Key Verified Metrics |
| --- | --- | --- |
| **S0 / G0** | Eliminated `2x` `structuredContent` payload duplication, deduplicated `get_Connection` buckets, added `next_id` in `follow_connectionchain`, retired dead code & `11,580` superseded shards (`20,000 → 8,420`). | `H8247` wire `-49.05%` (`32,427 → 16,520 B`), `47/47` R12/R13/literary tests, `32/32` R13 (`MRR: 0.9712`). |
| **S1 / G1** | STEP lexicon sanitization (`sanitize-step-lexicon.mjs`), CC BY 4.0 `OpenScriptorium/lxx-morph` Rahlfs 1935 alignment (`ingest-lxx-morph.mjs`), LLR-gated OEWN+Wikidata ontology (`build-sense-ontology.mjs`). | `19,566` profiles, `542` prefixes purged, `159` headwords rescued, `1,554` inflections collapsed; `23,878` LXX verses (`432,465` links, `AER = 0.0609 ≤ 0.14`); `10,416` senses, `0.27%` polysemy FP (`< 3%`); `12/12` `G1` tests. |
| **S2 / G2** | Morpheme/talion/onomastic valence wordplay (`wordplay-engine.ts`), Residual SSM + `B=200` refrain-pinned permutation/MDL chiasm & PELT changepoints (`literary-structure.mjs`, `literary-engine.ts` byte-synced to `bible-mcp/literary/`), lossless clause compiler (`build-v3-rhetoric.mjs`). | `31,203/31,203` verses & `443,621/443,621` tokens (`100%`) across `123,191` clauses (`35` files `< 1 MiB`); `16/16` `G2`+literary+wordplay tests; `64/64` literary benchmark. |
| **S3 / G3** | Uncompressed `BRV3BMW\0` bitset/BMW index (`v3-binary-index.ts`), 6-partition Typed Conductance CSR, offline Top-64 PPR shards, flat `v3/profiles/` & `v3/verses/` packs (`build-v3-index-and-graph.mjs`), sharded `rahlfs-concordance-00..07.bin`. | `44,655` indexed terms, `59,820` nodes, `2,257,390` CSR edges (`CONCEPT_PROC ≤ 0.0580 ≤ 0.06`), `59,608` PPR seeds; warm lookup `p50 = 0.0119 ms`, `p95 = 0.4421 ms < 1.0 ms`; `16/16` S3/S4/S5 tests. |
| **S4 / G4** | `E_perp` log-Bayes scorer & PPR subgraph augmentation (`v3-scorer.ts`, `v3-runtime-adapter.ts`, `subgraph-engine.ts`, `r10-discovery.ts`), Top-24 shortlist verifiers (`v3-verifiers.ts`), all `7` `*_v3` Worker RPCs, retirement of `r9b-v1.1` + `r8-v1.2`. | `100%` `NEG1`–`NEG8` rejection; `32/32` R13 (`MRR: 0.9712`); bundle `4,099 < 4,200` files (max `v3/` file `4.32 MiB < 10 MiB`); `0` HTTP `1102` in `workerd`. |
| **S5 / G5** | Progressive MCP `view: "clues"|"evidence"|"full"`, `expand_clue`, vowel-aware `get_Word`, stateless `~v3c:` `follow_connectionchain`, `7` `research` v3 ops + BMW `set_combine`, compact `get_prompt` (`5,530 B`), and Website UI wiring across all 5 discovery panels. | `6/6` `s5-mcp-v3`, `8/8` parity, `6/6` `mcp-defects`, `npm run check:types`, `vite build`, `npm run check:size` all pass. |
| **S6 / G6** | Blind 3-arm eval (`B1`–`B6`, `H1`–`H3`), `v3/verses/` routing fix for `literary_structure`, Wordplay/R10 guards for `50/50` adversarial controls, cold-isolate heap/subrequest/catalog-lite hardening, live production deployment & verification. | `v3` leads `9.18` vs `8.73` vs `7.95` (`9.44` on `H1`–`H3`); `50/50` adversarial; `11/11` `s4`+`s5`; `10/10` direct live Worker RPCs `200 OK`; `verify-corpus-security` `PASS`. |

---

## 3. Research-Driven Optimization Summary (`OPTIMIZATION_LOG.md`)

| Loop | Scope | Key Improvements | Measured Delta |
| --- | --- | --- | --- |
| **Cycle 1 → 2A** | Matched `D1`–`D4` retest (`73 → 70` calls) | Capped `sequence_parallels_v3` permutation CPU (`125.95 → 8.29 ms`), stateless `~v3c:` `follow_connectionchain`, chapter `"clues"` trimming, `PassageView` completeness. | Errors `5 → 0`; Dupes `4 → 0`; Wire `3,605.1 → 2,561.2 KB` (`-29.0%`); Max call latency `230.9 → 22.9 s` (`-90.1%`). |
| **Cycle 2B → 2b** | Fresh `V1`–`V4` (`73` calls) polish | Synthetic `expand_clue` handles (`passage_lxx:*`, `shared_lemma:*`, `r13:proof:*`), `G...` `lxx_concordance` + stopword filter, `tri_textual_diff` diacritics + `1 Pet 5:2` NT alignment repair, `H7462`/Swete hygiene, whole-range chain TF-IDF anchoring. | `11/11` `s4`+`s5` PASS; `workerd` `0` HTTP `1102` (`v3` handler `p50 = 2.59 ms`). |
| **Post-Eval S6** | Blind & live prod findings | Routed `handleGetLiterarySourceV1` & `runLiteraryStructureMcp` onto `/v3/verses/`; added contract-verb & mater/weak-root guards in `wordplay-engine.ts` + `G1027:G2362` filter in `r10-discovery.ts`; added `/v3/index/catalog-verses.bin` (`0.25 ms` vs `89.63 ms`), bounded `v3Lru` (`<= 4 MiB`), native `DecompressionStream`, batched shard parsing, and cold subrequest caps (`79–81 → 24–26`, max `40 ≤ 40`). | `literary_structure` `4/4` OK; `50/50` adversarial PASS; local isolate heap `11.6–35.7 MB`; `10/10` direct live RPCs `200 OK`. |

---

## 4. Controlled 3-Arm Blind Evaluation (`BLIND_SCORES.json`)

Blind packets randomized each system independently as `System X / Y / Z` per task after stripping tool logs, internal IDs, and arm labels (`0` leak audit hits across all 9 packets). Scoring used 6 dimensions (`0–10`) by two independent `blind_evaluator` agents (`B1`–`B6` and `H1`–`H3`).

### Aggregate Scores (`0–10`)

| Cohort | Arm | Rank #1 Wins | Overall Mean | Depth & Grounding | Verified Non-Redundant | Surprising / Rare | Bridges & Macro | Accuracy / Low FP | Research Utility |
| --- | --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **All 9 Tasks (`B1–B6 + H1–H3`)** | **No-MCP** | 0 / 9 | 7.95 | 7.06 | 8.26 | 7.88 | 8.42 | 8.14 | 7.96 |
| **All 9 Tasks (`B1–B6 + H1–H3`)** | **Live v2 MCP** | 3 / 9 | 8.73 | 8.82 | 8.61 | 8.81 | 8.67 | 8.71 | 8.78 |
| **All 9 Tasks (`B1–B6 + H1–H3`)** | **v3 MCP** | **6 / 9** | **9.18** | **9.22** | **9.13** | **9.24** | **9.14** | **9.08** | **9.23** |
| `B1–B6` (`N=6`) | No-MCP | 0 / 6 | 7.62 | 6.50 | 8.05 | 7.65 | 8.22 | 7.72 | 7.60 |
| `B1–B6` (`N=6`) | Live v2 MCP | 3 / 6 | **9.13** | **9.23** | **9.08** | 9.05 | **9.00** | **9.23** | **9.17** |
| `B1–B6` (`N=6`) | v3 MCP | 3 / 6 | 9.04 | 9.08 | 9.03 | **9.12** | 8.97 | 8.95 | 9.10 |
| **Frozen Holdout (`H1–H3`, `N=3`)** | Live v2 MCP | 0 / 3 | 7.94 | 8.00 | 7.67 | 8.33 | 8.00 | 7.67 | 8.00 |
| **Frozen Holdout (`H1–H3`, `N=3`)** | No-MCP | 0 / 3 | 8.61 | 8.17 | 8.67 | 8.33 | 8.83 | 9.00 | 8.67 |
| **Frozen Holdout (`H1–H3`, `N=3`)** | **v3 MCP** | **3 / 3** | **9.44** | **9.50** | **9.33** | **9.50** | **9.50** | **9.33** | **9.50** |

### Per-Task Rankings & Wire Telemetry (`research/v3/eval-final/BLIND_SCORES.json`)

- **B1** (`v3 > v2 > nomcp`: `9.02 / 8.75 / 7.37`), **B2** (`v2 > v3 > nomcp`: `9.22 / 8.78 / 7.40`), **B3** (`v3 > v2 > nomcp`: `9.23 / 8.98 / 7.63`), **B4** (`v2 > v3 > nomcp`: `9.37 / 8.67 / 7.62`), **B5** (`v3 > v2 > nomcp`: `9.43 / 9.02 / 7.85`), **B6** (`v2 > v3 > nomcp`: `9.43 / 9.12 / 7.87`). *(Note: `B1`–`B6` pre-fix `v3` hit the `literary_structure` `r8-v1.2` unavailability error repaired after `H1`–`H3`.)*
- **H1** (`v3 > nomcp > v2`: `9.50 / 8.83 / 8.00`), **H2** (`v3 > nomcp > v2`: `9.33 / 8.42 / 7.83`), **H3** (`v3 > nomcp > v2`: `9.50 / 8.58 / 8.00`).
- **Telemetry (`9` tasks):** `v2_live`: `124` calls (`13.8/task`), `15,615.0 KB` total (`1,735.0 KB/task`), `1` err, `0` dup; `v3_local`: `138` calls (`15.3/task`), `5,442.6 KB` total (`604.7 KB/task`, `-65.1%`), `0` dup.

---

## 5. Pre-Deploy Gate, Runtime & Security Verification

- **Adversarial Negative Controls (`node research/v3/eval-adversarial-50.mjs`):** **`50/50 PASS`** (`10` strophic/refrain chiasm traps, `10` suffix/weak-root wordplay traps, `10` hub/single-axis/number traps, `10` proper-name/niqqud traps, `10` false cross-anchor/polysemy traps).
- **R13 Benchmark (`node scripts/eval-r13-discovery.mjs`):** **`32/32 PASS`**, `MRR: 0.9712`, `NDCG@10: 0.9781`, `negative_control_rejection_rate: 1.0`, `epistemic_calibration_rate: 1.0`.
- **Unit & Integration Tests:** `16/16 PASS` (`s3-index-graph.test.mjs`, `s4-discovery-verifiers.test.mjs`, `s5-mcp-v3.test.mjs`).
- **`workerd` CPU & Heap Verification (`node scripts/verify-r12-worker.mjs --mode v3`):** **`PASS`** (`50` + `200` burst requests, `0` HTTP errors, **`0` HTTP `1102`**, `v3` handler CPU **`p50 = 3.753 ms`**, **`p95 = 7.085 ms`**). Cold subrequest audit: `2–40 ≤ 40` across all 9 RPCs (`tri_textual_diff_v3`: `24–26`, `discover_biblical_connections_v2`: `40`). Isolate heap across 13 consecutive calls: **`11.6–35.7 MB`**.
- **Security & Build Gates:** `node scripts/verify-corpus-security.mjs` **`PASS`** (`19` assertions, `0` restricted UBS keys, `raw_backups_public: false`); `npm.cmd run check:types` (`exit 0`); `npm.cmd run build` (`exit 0`); `npm.cmd run check:size` (`exit 0`); `.artifacts-r12/staging-bundle` **`4,099 < 4,200`** files (`224` `v3/` files, max `4.32 MiB < 10 MiB`).

---

## 6. Live Production Deployments & Verification

| Service | Live Endpoint / Ref | Active v3 Version ID | Rollback ID (`v2.0.0`) |
| --- | --- | --- | --- |
| **Corpus Worker (`bibleresearch-corpus`)** | `https://bibleresearch-corpus.kingdomfishers-custom.workers.dev` | **`1b20d201-5471-4f14-8a8b-8712316a5a22`** (`8 ms` startup) | `df1a9bf4-176b-4f26-a987-47539b745d28` (`r13-discovery-3`) |
| **Website (`bibleresearch`)** | `https://bibleresearch.kingdomfishers-custom.workers.dev` | **`c8867914-5cf4-4fc4-a24c-74e1fd497bd4`** | `e0ac5159-fc14-4572-8ec1-ecc1192e94d7` |
| **MCP Edge Function (`bible-mcp`)** | `https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp/mcp` | **Version `64`** (`verify_jwt: false`) | Pre-v3 deployment on `ejoperxiwxlcbsqrkrvb` |

- **Live `/health` & Security:** `bibleresearch-corpus/health` (`200 OK`), `bible-mcp/health` (`200 OK`, `authentication: none`, `corpus_target: production`), `verify-corpus-security.mjs` **`PASS`**.
- **Direct Live Worker RPCs (`10/10 PASS`):** Consecutive `200 OK` (`status: ok`) across `resolve_fast_lookup_v1 ("בֹּר")`, `wordplay_scan_v3`, `tri_textual_diff_v3` (`John 1:1-3` & `Matthew 2:6`), `lxx_concordance_v3`, `clause_role_query_v3`, `sequence_parallels_v3`, `expand_clue_v3`, `set_combine_v3`, and `analyze_literary_structure_v1`.
- **Live `/mcp` Smoke Checks (`mcp-bench-cli.mjs --target live`):** All 13 tool modes (`get_prompt`, `get_Passage`, `get_Word H1252`, `get_Word בֹּר`, `research` `tri_textual_diff`, `lxx_concordance`, `literary_structure`, `wordplay_scan`, `clause_role_query`, `sequence_parallels`, `set_combine`, `follow_connectionchain`) verified returning `status: ok`, `has_structured_duplicate: false`, and compact `"clues"` payloads.
- **Operational Note (Cloudflare Workers Free `10 ms` Cold CPU Cap):** Testing `"limits": { "cpu_ms": 30000 }` confirmed the account is on Cloudflare Workers Free (`code: 100328`). Cold US-East isolates encountering an uncached `2.5–5.5 MB` JSON shard can still occasionally trip the `10 ms` cold CPU limit (`503 Error 1102`, observed intermittently in `task-1815` / `task-1831`), whereas warmed isolates complete in `1–7 ms`. Upgrading to Workers Paid (`limits.cpu_ms`) or range-packing `v3/verses/` and `v3/profiles/` removes that remaining cold-JSON-parse spike cleanly if needed.
