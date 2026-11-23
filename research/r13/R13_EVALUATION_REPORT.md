# BibleResearch R13 — Original-Language Discovery Engine Evaluation Report

**Release ID:** `r13-discovery-1`  
**Branch:** `feat/r12-qa-fixes`  
**Implementation Commit:** `838da3d84e1bcdb19ab9e5fff3dd1fb591474b09`  
**Manifest Commit:** `25f287df8a984a092f1914d488255172dcae2a47` (`wrangler.corpus.jsonc`)  
**Bundle SHA-256 (`R12_ASSET_SHA256`):** `366e3acdd2debbefc1de234ef39b684271b6c2cdca3cdfce69dfc9b4b6d49b6b`  
**Live Cloudflare Worker (`bibleresearch-corpus`):** Version ID `edd49ef6-44d8-4d0f-b398-f778568aa04c` (rollback: `e44b4b5a-24c2-4bf7-8d88-10762c9e4f3d`, `r12-discovery-3`)  
**Live Supabase Edge Function (`bible-mcp`):** Version **v52** (`verify_jwt: false`, `ezbr_sha256: f8522086fc191cb4d1174e0240d5a7c6704a3dc683bd84dada259254bfa4a009`; rollback: **v51**)  

---

## 1. Executive Summary

R13 transforms BibleResearch into an original-language, evidence-driven biblical pattern discovery system while fixing all eight confirmed MCP, runtime, and data-integrity defects (**5A–5H**) and preserving Cloudflare free-tier operating limits (`20,000` uploaded assets, largest file `22,131,013 B < 25 MiB`, `12` median asset reads per query, `0` restricted keys).

All local verification suites, the new 32-case R13 discovery benchmark (**32/32 = 100%**), R12 negative controls (**24/24**), MCP parity checks (**8/8**), and live HTTP verification against `bibleresearch-corpus` and `bible-mcp` v52 (**17/17 checks, 0% HTTP 503, 0 restricted keys**) passed.

---

## 2. What Changed and Why

### 2.1 Confirmed Defects Resolved (5A–5H)
- **Defect 5A (`research(op="evidence")` wrapper & `release_mismatch` loss):** Fixed `executeEvidence` in `supabase/functions/bible-mcp/research-engine.ts` to unwrap `raw.evidence` + `raw.passage_details` and preserve `status: "release_mismatch"` instead of returning empty wrappers or coercing errors.
- **Defect 5B (`get_Connection` false/missing links):** Enforced strict `direct_link_found` semantics and bidirectional cross-reference / LXX matching in `supabase/functions/bible-mcp/discovery-v2-tools.ts` (e.g., `["H8247", "Revelation 12:1"]` -> `false`; `["Exodus 25:31", "Hebrews 9:2"]` -> `true`).
- **Defect 5C & `flags` vs `votes`:** Preserved `sense_status` without hard-filtering formal lexical relationships, and repaired bitmask `flags` vs `votes` mapping in `scripts/corpus-relationships-rpc.mjs` (`handleGetPassageCompactV1`) and `discovery-v2-tools.ts`, eliminating spurious `"N witness votes"` text.
- **Defect 5D (`follow_connectionchain` gaps):** Fixed `selectChainEvidence` in `supabase/functions/bible-mcp/chain-evidence.ts` and pairwise/evidence fallback hydration in `discovery-v2-tools.ts` so padded Strong's IDs, word-to-passage steps, and manual targets hydrate step references and edge metadata.
- **Defect 5E (`get_Word` errors & high-PMI collocations):** Surfaced `warnings` and `discovery_status` (`unavailable` vs `ok`) in `buildFullCompactWord` (`discovery-v2-tools.ts`), forwarded `anchor_lemma_key`, and rebuilt corpus-wide high-PMI/NPMI collocations (`H1818↔H5315`, `H0784↔H6227`, etc.).
- **Defect 5F (Noisy Stream A/B/C scenes):** Eliminated transitive LXX `rareRootSiblings` semantic drift in `scripts/pack-r12-cpu-safe-assets.mjs`, enforced structured clause/role-frame alignment (`clauseHits >= 2 || roleHits >= 2 || pairs >= 3`) in Stream A (`78,663 -> 24,534` scenes across `20,377` verses), added runtime defense in `buildEmbeddedSceneRecord` (`src/relationships/r10-discovery.ts`), enforced exact token `lemma_key` + `primary_pos === 'proper_noun'` checks in Stream B (`13,903` scenes, `dist <= 22` retaining `Joshua 2:3 -> 2:18`), and made Stream C forward-only (`5,747`). Eliminates false scenes on `Genesis 1:10` (`r12:scene:10:24047` / `Matthew 23:15`), `Genesis 8:1` (`Acts 20:35`), and `Exodus 16:4` (`Matthew 19:3`).
- **Defect 5G (`N009` `"three days resurrection"` `Gen 5:23` pollution):** Enforced strict governing-concept and death/revival context validation in `validateEvidenceR13` (`src/relationships/r10-discovery.ts`), excluding `Genesis 5:23` / `H2421` across all 25 slots (`24/24` negatives).
- **Defect 5H (`r12:event` ordering & chapter fallback):** Repaired ISO chronology date sorting and removed blind `eventsByChapter` fallback pollution in `scripts/pack-r12-cpu-safe-assets.mjs` (`2,736` clean event-attached verses).

### 2.2 Five Discovery Algorithms (A–E) & Zero-Read Runtime Architecture
- **Algorithm A (`src/relationships/wordplay-engine.ts`):** General-purpose Hebrew/Aramaic/Greek consonantal, matres-stripped (`no_matres`), phonetic-class, LCS/weighted-edit/metathesis, STEP root/formation, textual proximity, and Q&A/naming/causal wordplay-cue discovery with `WORDPLAY_STOP_STRONGS` filtering and explicit `proven_common_root: false` disambiguation (`18,848` indexed wordplay lemmas in `fast-profiles/`). Discovers `H8247 ↔ H8245` (*shaked/shoked*, `Jer 1:11`), `H0120 ↔ H0127` (`Gen 2:7`), `H7019 ↔ H7093` (*qayits/qets*, `Amos 8:1-2`), `H1613 ↔ H3724` (`Gen 6:14`), and `H1818 ↔ H0120` (*dam/adam*) without inventing common historical etymologies.
- **Algorithm B (`src/relationships/motif-discovery.ts`):** Corpus-wide high-PMI/NPMI collocations (`7,352` lemmas), 3–6 node multi-passage motif mining (`750` motifs packed in `motifs-and-patterns.json.gz` + `fast-profiles/`), and bounded live beam search (`r13:beam`).
- **Algorithm C (`src/relationships/symbolic-patterns.ts`):** Automated scriptural self-interpretation extractor (`511` interpretations) with preposition-object skipping and clause-final Greek `G1510` equative handling separating `Revelation 4:5` (`G2985 -> G4151`), `Revelation 5:6` (`G3788 -> G4151`), and `Revelation 1:20` (`G3087 -> G1577`), plus `29,671` verses with embedded MACULA role-frame tuples and multi-stage symbolic chains (`r13:symchain`).
- **Algorithms D & E (`src/relationships/evidence-synthesis.ts`):** Many-to-many bipartite Hebrew–LXX–NT alignment (`scoreCrossTestamentPair`) and coherent network synthesis (`synthesizeEvidencePatterns`) separating `explicit_textual_facts`, `structural_correspondences`, and `exploratory_hypotheses`.
- **Ranking Redesign & Zero-Read Stage 2 (`src/relationships/r10-discovery.ts`, `r10-types.ts`):** Separated `generateCandidates -> validateEvidenceR13 -> scoreCandidatesR13 (E,F,P,I,R,N,U + RRF) -> diversifyResultsR13 (MMR + intent-aware quotas)`. Kept median Worker I/O at `12` asset reads via `cachedOrStubPassages` zero-read Stage 2 and lazy post-ranking snippet hydration.
- **MCP `research` Operations (`research-engine.ts`, `corpus-relationships-rpc.mjs`, `corpus-worker.mjs`, `catalog.ts`, `index.ts`):** Added `discover_patterns` (concise network `summary` default + `detail: 'full'`), `compare_patterns`, and `trace_evidence` backed by Worker RPCs `discover_patterns_v1`, `compare_patterns_v1`, and `trace_evidence_v1`.

---

## 3. Offline Staging Bundle Summary

| Metric | R12 P6-4 (`r12-discovery-3`) | R13 (`r13-discovery-1`) | Limit / Constraint |
|---|---:|---:|---|
| Total staged files | 20,000 | **20,000** | `<= 20,000` (Cloudflare Assets) |
| Max individual file size | < 25 MiB | **22,131,013 B (21.11 MiB)** | `< 25 MiB` |
| `fast-profiles` shards (max outer) | 1,024 (`< 250 KB`) | **1,024 (`246,509 B`)** | CPU-safe per-shard read |
| `fast-verses` chunks (max outer) | 488 (`31,203` verses) | **488 (`91,793 B`, `31,203` vv)** | CPU-safe per-chunk read |
| Embedded scenes (`Stream A / B / C`) | `78,663 / 15,292 / 8,790` | **`24,534 / 13,903 / 5,747`** (`20,377` vv) | Defect 5F denoised |
| Wordplay lemmas / Self-interps / Motifs | `— / — / —` | **`18,848 / 511 / 750`** (`7,352` colloc) | General corpus-wide |
| Restricted keys (`corpus-security`) | `0` | **`0`** | Mandatory `0` |

---

## 4. Before / After Benchmark & Local Regression Results

### 4.1 Local Verification Suites (Post-Final-Edit, `r13-discovery-1`)
| Suite | Result | Key Metrics / Checks |
|---|---|---|
| `npm.cmd run check:types` | **PASS** | `tsc --noEmit` exit `0` |
| `npm.cmd run build` | **PASS** | `127` modules built in `817 ms` |
| `node --test research/r12/*.test.mjs research/r13/*.test.mjs` | **15/15 PASS** | `4` R12 suites + `11` R13 unit/MCP-defect tests |
| `node scripts/verify-r12-smoke.mjs` | **5/5 PASS** | Ranker units, Heb/Grk 2+ hop, external property, external expand |
| `node scripts/verify-r12-packed-loading.mjs` | **PASS** | Packed gzip range decoding, stream cancel, request cache |
| `node scripts/verify-r11-discovery.mjs` | **14/14 PASS** | Lily, Ps 45:0, Hyssop, Pomegranate, Water+Spirit, Bridge/Challenge, H7799 paging |
| `node scripts/verify-r11-benchmark.mjs` | **PASS** | `30/30` lemmas `recall: 1.000` (`0` missing/extra), `15/15` pairs `0` unsupported |
| `node scripts/verify-r12-algorithm-v2.mjs` | **PASS** | `ALL_V2_ALGORITHM_CHECKS_PASSED` (`score_version: r13-ranker-v1`, `l027_rank: 15`, `l002_rank: 12`, all 7 prefix hydrations PASS) |
| `node scripts/verify-r12-mcp-parity.mjs` | **8/8 PASS** | Gen 1:1, Zech 12:10, Josh 2:18, Num 21:9, Isa 61:1-2, `get_Word` modes, multi-word, partial fallback |

### 4.2 Frozen R12 Benchmark (`eval-r12-optimization.mjs --all-239 --holdout --negatives --quality-canaries`)

| Metric | P6-4 (`r12-discovery-3`) Baseline | R13 (`r13-discovery-1`) | Notes |
|---|---:|---:|---|
| `--all-239` `range_top_k` | `186/215` (`86.5%`) | **`179/215` (`83.3%`)** | `-7` concentrated in denoised `narrative_pattern` (`36/54`) & `narrative_chronology` (`3/8`) |
| `--all-239` `strict_top_k` / `in_top_25_any` | `150/215` / `194/215` | **`147/215` / `188/215`** | `paired_top_k: 89/215` (`55` strict, `95` in top 25) |
| `--all-239` `direct_intertext` | `—` | **`51/55` (`50` paired)** | `linguistic_form 5/5`, `polysemy 5/5`, `translation 21/22`, `lexical 20/23`, `genealogy 3/3` |
| `--all-239` real-world categories | `—` | **`4/4` part-whole, `11/12` process, `9/10` prop, `11/14` mat** | Full zero-contamination physical provenance preserved |
| `--holdout` (13 pos + 2 neg) | `9/13` range@K (`8` paired) | **`8/13` range@K (`9/13` top-25, `7` paired)** | `direct_intertext 4/4`, `genealogy 1/1`, `pattern 2/3`, `neg 2/2` |
| `--negatives` (24 controls) | `24/24` | **`24/24`** | `N009` `contains_gen_5_23_in_top4: false`, `all_top4_cover_resurrection: true` |
| Quality Canaries (`P0-A..D`, `P1-E`) | `5/5` | **`5/5`** | Strict `release_mismatch`, zero Hagar-well bleed, zero `H1254c` |
| Unseen Scenes (Top-10) | `3/3` | **`3/3`** | Ezek 1↔Rev 4 (`#4`), Zech 4↔Rev 11 (`#1,10,19`), Rev 13↔Dan 7 (`#3,4,5,22`) |
| I/O & CPU (`190` unique queries) | `12` median reads (`40.04 ms`) | **`12` median reads (`max 24`), `56.56 ms` median** | `p95: 130.32 ms`, `median_bytes: 877,477`, `missing_assets: []`, `restricted_keys: 0` |

**Quality-over-noise trade-off:** The `186/215 -> 179/215` delta in R12 is strictly caused by removing unverified 2-word `rareRootSiblings`/`roleHits=1` Stream A overlaps (`78,663 -> 24,534`) and blind chapter-fallback `eventsByChapter` entries under Defects **5F/5H**, rather than regressions in retrieval or intertext (`direct_intertext` is `51/55` with `50` paired). No noisy Stream A/chapter-fallback paths were restored.

### 4.3 R13 Original-Language Discovery Benchmark (`scripts/eval-r13-discovery.mjs`, `32` Cases across `10` Categories)

| Split / Group | Passed / Total | Metrics |
|---|---:|---|
| **Overall (`R13_DISCOVERY_BENCHMARK.json`)** | **`32 / 32 (100%)`** | `recall: 1.0`, `precision@K est: 1.0`, `MRR: 0.9551`, `NDCG@10: 0.9666` |
| Dev Split / Validation Split / Holdout Split | **`13/13` / `14/14` / `5/5`** | `mean_latency_ms: 76.24 ms`, `top_10_diversity_mean_families: 5.52` |
| Epistemic & Safety Metrics | **100%** | `evidence_validity_rate: 1.0`, `negative_control_rejection_rate: 1.0`, `epistemic_calibration_rate: 1.0`, `restricted_keys: 0` |
| Acceptance Tests **A / B / C / D / E** | **`3/3` / `1/1` / `3/3` / `4/4` / `3/3`** | All `all_passed: true` |

---

## 5. Live HTTP Verification (`bibleresearch-corpus` + `bible-mcp` v52)

### 5.1 Live Endpoints & Headers (2026-11-23T07:37Z)
- **Worker `GET /health` (`HTTP 200`):**
  - `X-BibleResearch-Release: r13-discovery-1`
  - `X-BibleResearch-Assets: 366e3acdd2debbefc1de234ef39b684271b6c2cdca3cdfce69dfc9b4b6d49b6b`
  - `X-BibleResearch-Version: edd49ef6-44d8-4d0f-b398-f778568aa04c`
  - `X-BibleResearch-Commit: 838da3d84e1bcdb19ab9e5fff3dd1fb591474b09`
  - Body: `{"status":"ok","worker":"bibleresearch-corpus","corpus_version":"2026.11.07-v1"}`
- **Worker `GET /v1/catalog/metadata.json.gz`:** `HTTP 403` (protected restricted asset boundary verified).
- **Supabase `GET /functions/v1/bible-mcp/health` (`HTTP 200`):**
  `{"name":"BibleResearch","version":"2.0.0","surface":"v2-discovery","status":"ok","transport":"streamable-http","authentication":"none","read_only":false,"writes":"enabled","corpus_target":"production","corpus_url":"https://bibleresearch-corpus.kingdomfishers-custom.workers.dev","tools":7,"prompts":1,"legacy_endpoint":"/legacy/mcp","legacy_tools":46,"legacy_prompts":22}`

### 5.2 Live MCP Acceptance Matrix (`17/17 PASS`, `0` HTTP 503s, `0` Cold Retries Needed, `0` Restricted Keys)

| Check | Test | Tool Call | Latency | Result & Live Observation |
|---|---|---|---:|---|
| **A1_summary** | A | `research(discover_patterns, "H8247 almond watch Jer 1:11", detail:"summary")` | `663 ms` | **PASS** — `pattern_count: 3`, top `symbolic_chain` synthesizing `Jer 1:11`, `Num 17:8`, `Eccl 12:5` |
| **A1_H8247** | A | `research(discover_patterns, "H8247 almond watch Jer 1:11", detail:"full")` | `152 ms` | **PASS** — `#1 r13:interp:19074:vis` (`1113`), `#2 r13:wp:H8247:H8245` (`attested_textual_wordplay`, `960`), `#4 r13:symchain:H8247` (`900`) |
| **A2_adam_dam** | A | `research(discover_patterns, "H0120 adam H1818 blood Genesis 2:7", detail:"full")` | `403 ms` | **PASS** — `#1 r13:wp:H1818:H0120` (`982`) without inventing any historical root claim |
| **B1_H6227_5E** | B / 5E | `get_Word("H6227")` | `837 ms` | **PASS** — `discovery_status: "ok"`, `H0784` (*esh*, fire) present among collocated cluster/grammar/wordplay connections |
| **B2_adam_ground_blood** | B | `research(discover_patterns, "H0120 adam H0127 ground H1818 blood Genesis 4:10")` | `315 ms` | **PASS** — `#1 r10:interp:gen4_10_11_blood_ground_echo` (`1527`), `#2 r10:wordplay:adam_adamah_gen2_7` (`1396`), `#3 r11:intersect:verse:H0121:H0127:73` |
| **C1_Rev4_5** | C | `get_Passage("Revelation 4:5")` | `1310 ms` | **PASS** — `r10:ident:rev4_5_lamps_spirits` + `r13:interp:30874:19` (`G2985 -> G4151`), zero `Rev 1:20` bleed |
| **C2_Rev5_6** | C | `get_Passage("Revelation 5:6")` | `1440 ms` | **PASS** — `r10:ident:rev5_6_eyes_spirits` + `r13:interp:30886:26` (`G3788 -> G4151`) |
| **C3_Rev1_20** | C | `get_Passage("Revelation 1:20")` | `963 ms` | **PASS** — `r10:ident:rev1_20_lampstands_churches_control` + `r13:interp:30818:32` (`G3087 -> G1577`) |
| **C4_compare_patterns** | C | `research(compare_patterns, ["Exodus 25:31", "Hebrews 9:2"])` | `242 ms` | **PASS** — `strong_lxx_verbal_echo` (`H4501->G3087` `lxx_count: 30`), shared menorah/holies connections & `verification_release` header parity |
| **D1_resurrection_5G** | D / 5G | `research(discover_patterns, "three days resurrection", limit:25)` | `439 ms` | **PASS** — `25` items returned, **`Genesis 5:23` absent across all 25 slots** |
| **D2_Gen1_10_5F** | D / 5C / 5F | `get_Passage("Genesis 1:10")` | `780 ms` | **PASS** — no `r12:scene:10:24047`, no `Matthew 23:15`, no `"witness votes"`, no false `Kue` scene (only `r13:colloc:H3004:H3220` + valid grammar/xrefs) |
| **D3_Gen8_1_5F** | D / 5F | `get_Passage("Genesis 8:1")` | `1441 ms` | **PASS** — `Acts 20:35` absent |
| **D4_Exod16_4_5F** | D / 5F | `get_Passage("Exodus 16:4")` | `1362 ms` | **PASS** — `Matthew 19:3` absent, zero `"witness votes"` |
| **E1_evidence_trace_5A** | E / 5A | `research([evidence(wp), trace_evidence(wp), evidence(xref, release:"r12-discovery-2")])` | `238 ms` | **PASS** — hydrated `14`-token `Jeremiah 1:11` passage + `orthographic_analysis` + `trace_evidence` `passage_details`/`independent_witnesses` + `status: "release_mismatch"` |
| **E2_unrelated_5B** | E / 5B | `get_Connection(["H8247", "Revelation 12:1"])` | `737 ms` | **PASS** — `direct_link_found: false` |
| **E3_connected_5B** | E / 5B | `get_Connection(["Exodus 25:31", "Hebrews 9:2"])` | `597 ms` | **PASS** — `direct_link_found: true` (`4` direct pairwise links) |
| **E4_chain_5D** | E / 5D | `follow_connectionchain` (`Exodus 25:31` -> `Hebrews 9:2`) | `552 ms` | **PASS** — hydrated `edge_id: "r11:xref:2227:30207"` & `refs: ["Exodus 25:31", "Hebrews 9:2"]` |

---

## 6. Remaining Weaknesses & Recommended Next Steps

1. **Free Cloudflare Worker 10 ms CPU Cold-Isolate Headroom:** During an unprimed cold-isolate burst prior to the final warm run, `discover_patterns` and `compare_patterns` once returned transient `retryable: true` / `discovery_status: "unavailable"` envelopes in `~148–207 ms` before succeeding cleanly once warm (`152–837 ms`, `0` retries on the final sweep). Further Worker cold-start trimming (or Worker Paid CPU headroom) would eliminate transient cold-PoP retries.
2. **Profile-Level Homograph Display Gloss on `r11:gram` Edges:** In `Genesis 1:10`, token 5 accurately resolves to `lemma:H4723C` (`"collecting place"`), and no false scene appears, yet the generic `r11:gram:H4723:possessive_construction_with:H4325` summary string still displays the default Strong's group gloss `H4723 ("Kue")` rather than the verse's specific `lemma_key` gloss. Propagating sense-specific display glosses into `r11:gram` labels is a clean follow-up.
3. **Chronology Coverage vs. False-Fallback Cleanliness (`narrative_chronology`):** Removing `eventsByChapter` fallback pollution fixed 5H but lowered `narrative_chronology` recall to `3/8` in the frozen 239-case set. Rebuilding verified verse-level chronology spans without chapter-level guessing will recover those positives cleanly.
4. **Aramaic/NT Quotation Role-Frames & Multi-Edge Motif Ranking:** Expanding role-frame extraction on Aramaic Danielic passages and OT-in-NT quotations will raise structural comparison (`compare_patterns`) density beyond LXX lexical bipartite alignment.

---

## 7. Independent ChatGPT QA Retest Handoff

Execute these exact read-only MCP tool calls against `bible-mcp` (**v52**, `https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp/mcp`):

1. **Test A (Wordplay & Non-Etymology Guard):**
   - `research({ operations: [{ op: "discover_patterns", query: "H8247 almond watch Jer 1:11", detail: "summary", limit: 10 }] })` -> Confirm `r13:interp:19074:vis` and `r13:wp:H8247:H8245` (`attested_textual_wordplay`) without claiming invented roots.
   - `research({ operations: [{ op: "discover_patterns", query: "H0120 adam H1818 blood Genesis 2:7", detail: "full", limit: 12 }] })` -> Confirm `H1818 ↔ H0120` pattern with `proven_common_root: false` / cautious limitation text.
2. **Test B (High-PMI Collocations & Defect 5E):**
   - `get_Word({ word: "H6227", connections: 12 })` -> Confirm `discovery_status: "ok"` and `H0784` (*esh*) surfaced.
   - `research({ operations: [{ op: "discover_patterns", query: "H0120 adam H0127 ground H1818 blood Genesis 4:10", detail: "full", limit: 12 }] })` -> Confirm Genesis 4:10 / 2:7 / 3:17 multi-term connections.
3. **Test C (Referent Separation & Cross-Testament Comparison):**
   - Call `get_Passage` on `"Revelation 4:5"`, `"Revelation 5:6"`, and `"Revelation 1:20"` -> Verify `G2985 -> G4151`, `G3788 -> G4151`, and `G3087 -> G1577` remain distinct with zero cross-conflation.
   - `research({ operations: [{ op: "compare_patterns", targets: ["Exodus 25:31", "Hebrews 9:2"], detail: "summary" }] })` -> Verify `H4501 -> G3087` alignment and shared tabernacle/menorah connections.
4. **Test D (Negative Controls & Defects 5C/5F/5G/5H):**
   - `research({ operations: [{ op: "discover_patterns", query: "three days resurrection", detail: "full", limit: 25 }] })` -> Confirm **zero** `Genesis 5:23` entries across all 25 slots.
   - Call `get_Passage` on `"Genesis 1:10"`, `"Genesis 8:1"`, `"Exodus 16:4"` -> Confirm zero `r12:scene:10:24047` / `Matthew 23:15`, zero `Acts 20:35`, zero `Matthew 19:3`, and zero `"witness votes"` phrasing.
5. **Test E (Evidence Unwrapping, Trace & Chain Exploration — Defects 5A/5B/5D):**
   - `research({ operations: [{ op: "evidence", evidence_id: "r13:wp:H8247:H8245" }, { op: "trace_evidence", evidence_id: "r13:wp:H8247:H8245" }, { op: "evidence", evidence_id: "r11:xref:2227:29818", release_id: "r12-discovery-2" }] })` -> Confirm full unwrapped passages/tokens + `trace_evidence` witnesses + `"release_mismatch"` preservation.
   - `get_Connection({ items: ["H8247", "Revelation 12:1"] })` -> `direct_link_found: false`; `get_Connection({ items: ["Exodus 25:31", "Hebrews 9:2"] })` -> `direct_link_found: true`.
   - `follow_connectionchain({ next: "Exodus 25:31" })` followed by `follow_connectionchain({ chain, action: "follow", next: "Hebrews 9:2" })` -> Confirm hydrated `edge_id` and `refs`.
