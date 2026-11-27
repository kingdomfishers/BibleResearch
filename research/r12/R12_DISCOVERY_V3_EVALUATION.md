# Discovery Algorithm v3 (`r12-discovery-3`) Evaluation Report

**Date:** 2026-11-23  
**Workspace:** `C:\Projects\BibleResearch-r10` (`feat/r12-qa-fixes`, base commit `f4cff1c95a5d4c291dd03f85c3a01b21d7ce2f7a`)  
**Release Metadata:** `R12_RELEASE_ID = "r12-discovery-3"`, `R12_ASSET_SHA256 = "e0f4476489e98b3117e0546ef38d9b70f90282d66b059a1bb0f5abf90e040921"`

---

## 1. Root-Cause Summary & Architectural Changes

### Baseline Discrepancy Resolved
1. **Live Cloudflare Worker 10 ms CPU Exhaustion (HTTP 503 `Error 1102`):** Although live `bibleresearch-corpus` (`93de1432-6121-4204-bf69-d6a3c547192e`) already ran Round-4 discovery code (`7c326d4`), passage and multi-concept queries (`Genesis 1:1` 30 reads / 3.12 MB raw, `three days resurrection` 34 reads / 3.99 MB raw) exceeded the free Worker CPU budget, causing `bible-mcp` `safeCallFirst` to fail silently and fall back to raw `v.xrefs` + generic LXX/grammatical entries.
2. **MCP Surface Mismatch (`supabase/functions/bible-mcp/discovery-v2-tools.ts`):**
   - `handleGetPassage` checked `c.relation.includes('bridge')` (matching every `lxx_translation_bridge`), splicing raw cross-testament xrefs and lexical highlights ahead of `discover_biblical_connections_v2` ranking order and requesting insufficient discovery depth.
   - `buildFullCompactWord` collapsed multi-word concept queries (e.g. `"three days resurrection"`) into a single Strong's ID (`H3117` via `focus_lemma`) and did not accept or forward `mode`.
3. **Retrieval & Span Truncation Gaps:** Runtime `hydratePassageByVid` overwrote multi-verse xref end-verse spans (`John 19:34-37`, `Revelation 12:7-17`), pure-degree top-20 xref truncation evicted key OT↔NT links (`Exodus 25:31 → Hebrews 9:2`, `2 Kings 20:5 → Hosea 6:2`), and missing offline cross-book scene / pericope proper-name structures hid non-editorial typology and genealogy bridges (`Joshua 2:18 → Matthew 1:5`).

### Implemented Upgrades (`r12-discovery-3`)
1. **Offline Asset Pack (`scripts/pack-r12-cpu-safe-assets.mjs --verses-only`):**
   - Kept total bundle files at `20,000` (`0` restricted keys across `488` chunks; `asset_sha256: e0f4476489e98b3117e0546ef38d9b70f90282d66b059a1bb0f5abf90e040921`).
   - Packed IDF-, lexical-, LXX-, and phrase-corroborated top-24 7-tuple xrefs (`[toVid, toRef, phrase, flags, lexCount, lxxCount, idf10]`).
   - Embedded compact cross-book structural/lexical scenes (`Stream A`, `78,663` edges -> `r12:scene`), pericope personal proper-name cross-testament bridges (`Stream B`, `15,292` edges -> `r12:entity`), and same-chapter rare-lemma progressions (`Stream C`, `8,790` edges -> `r12:prog`) across `29,284` verses (`fast_verses_max_outer_bytes = 89,267`).
2. **Intent-Aware Discovery, Scoring & CPU Efficiency (`src/relationships/r10-types.ts`, `src/relationships/r10-discovery.ts`):**
   - Classified queries into `R10QueryIntent` (`passage_intertext`, `physical_bridge`, `multi_concept`, `lexical`, `open_discovery`) and exposed `query_intent` on results/summaries.
   - Added `applyRangeRef` to preserve multi-verse canonical boundaries (`John 3:14-15`, `John 19:34-37`, `Revelation 12:7-17`) and `buildRefStub` zero-read target parsing in Stage 2 (`E2`, `scenes`, `neighborXrefCands`) plus lazy post-ranking snippet hydration (`<= 2` reads, top 4 cards), cutting single-verse asset reads by ~50%.
   - Unlocked all `24` embedded xref tuples in Stage `E2`, calibrated corroborated OT↔NT xrefs above same-testament heuristic scenes and pericope neighbors, removed `+130` `r11:xref` bridge distortion when `query.mode === 'bridge'`, collapsed duplicate `(source_bs, target_bs)` `r11:lxx`/`r11:lex` pairs, and applied intent-specific family diversification caps.
   - Added `r12:scene:`, `r12:entity:`, `r12:prog:`, and range-ref hydration in `getConnectionEvidence`.
3. **7-Tool MCP Parity (`supabase/functions/bible-mcp/discovery-v2-tools.ts`, `scripts/verify-r12-mcp-parity.mjs`):**
   - `handleGetPassage` now requests `limit: Math.min(25, Math.max(input.depth, 15))`, preserves `discover_biblical_connections_v2` ranking order (round-robin interleaved for multi-verse queries), deduplicates fallback xrefs by ID and normalized passage pair, and sets `discovery_status: 'partial'` on discovery RPC failure.
   - `get_Word` exposes optional `mode: 'discover' | 'bridge'` and forwards full multi-word concept queries without collapsing to a single `focus_lemma`.

---

## 2. Before / After Benchmark & IO Comparison

| Metric | Round-4 Local (`r12-discovery-2`) | Live 2026-11-22 MCP Retest | `r12-discovery-3` Local |
|---|---:|---:|---:|
| **Positives `range_top_k` (215)** | `170 / 215` (79.1%) | `110 / 186` assessable | **`186 / 215` (86.5%)** |
| **Positives `strict_top_k` (215)** | `169 / 215` (78.6%) | `110 / 186` assessable | `150 / 215` (69.8%)* |
| **Positives `in_top_25_any` (215)** | `180 / 215` | `137 / 186` | **`194 / 215` (90.2%)** |
| **Positives `absent_in_25` (215)** | `35` | `49` | **`21`** (-40%) |
| **Paired Witnesses `paired_top_k`** | `77 / 215` | — | **`94 / 215`** (+17) |
| **`direct_intertext` `range_top_k` (55)** | — | — | **`52 / 55` (94.5%)**, `51` paired |
| **Frozen Holdout `range_top_k` (13)** | `7 / 13` | — | **`9 / 13`** (`11/13` in 25, `8/13` paired) |
| **Frozen Holdout Negatives (2)** | `2 / 2` | — | **`2 / 2`** (`0` restricted keys) |
| **Negative Controls (24)** | `24 / 24` | — | **`24 / 24`** (`N009` all top-4 valid) |
| **Quality Canaries (`P0-A..D`, `P1-E`)** | `5 / 5` | — | **`5 / 5`** |
| **Unseen Prophetic Scenes (3)** | `3 / 3` top-10 | — | **`3 / 3` top-10** |
| **Top-5 `r11:lxx` + `r11:gram` Share** | — | `62.5%` (`594 / 950`) | **`21.2%` (`201 / 950`)** |
| **239-Case Median Reads / Bytes / ms** | ~24 reads / ~1.7 MB | 503 fallbacks on heavy queries | **`12` reads / `757,960 B` / `40.04 ms`** |

\* *Note on `strict_top_k` vs `range_top_k` / `paired_top_k`:* Preserving accurate multi-verse pericope ranges (e.g., `John 3:14-15`, `Luke 4:18-19`, `Matthew 5:3-5`, `Acts 2:17-33`, `John 19:34-37`) intentionally scores as canonical range matches (`range_top_k`: `170 -> 186`, `paired_top_k`: `77 -> 94`) rather than truncating multi-verse citations to single start verses.

### Per-Query Asset Read & Live Worker Latency Profile
- **`Genesis 1:1`:** Baseline `30 reads / 1771.2 KB gz / 3119.4 KB raw` (Live HTTP **503**) → **`r12-discovery-3` `13 reads / 790.5 KB gz / 1359.9 KB raw` (Live HTTP 200, 1107 ms)**
- **`Isaiah 61:1`:** **`12 reads / 702.6 KB gz / 1143.6 KB raw` (Live HTTP 200, 726 ms)**
- **`Zechariah 12:10`:** **`13 reads / 828.3 KB gz / 1367.5 KB raw` (Live HTTP 200, 560 ms)**
- **`Joshua 2:18`:** **`13 reads / 894.3 KB gz / 1412.5 KB raw` (Live HTTP 200, 703 ms)**
- **`three days resurrection`:** Baseline `34 reads / 2356.0 KB gz / 3992.0 KB raw` (Live HTTP **503**) → **`r12-discovery-3` `24 reads / 1,873,083 B` in `eval` `--limit 25` (Live HTTP 200 on `--limit 15`, 1620 ms)**
- **`H5178` (`bridge`):** **`4 reads / 143.5 KB gz / 265.6 KB raw` (Live HTTP 200, 45 ms)**

---

## 3. Examples of Newly Surfaced & Better-Ranked Connections (Observed Locally & Live)

1. **`Numbers 21:9` (unseen probe):** `r11:xref:4350:26241` (`Numbers 21:9 → John 3:14-15`) ranked **#2 (`@877`)** and `r12:entity:4350:27258` (`Numbers 21:9 ↔ Acts 7:36`) ranked **#4 (`@865`)** cleanly in both live Corpus Worker and live `bible-mcp` `get_Passage`.
2. **`Joshua 2:18` (`S028`):** `r12:entity:5888:23266` (pericope proper-name bridge Rahab `H7343 → G4477` in `Matthew 1:5`) surfaced directly at **#5 (`@865`)** in live Worker and live `get_Passage`.
3. **`three days resurrection` via `bible-mcp` `get_Word`:** Previously collapsed to single-lemma `H3117` (`days`) occurrences; now returns `r11:xref:23646:26221` (`Matthew 12:40 → John 2:19`, **#1**) followed by `John 11:24`, `Matthew 16:21`, `Matthew 22:23`, and `Acts 1:22`.
4. **`Genesis 1:1` via `bible-mcp` `get_Passage`:** No longer spliced with raw LXX/grammar entries; returns `r10:corresp:gen1_to_rev4_rev21_creation_spirits` (**#1**), `Revelation 10:6` (**#2**), `Hebrews 1:10` (**#3**), `Colossians 1:16-17` (**#4**), and `r12:scene:1:23881` (`Matthew 19:4`, **#5**).
5. **Additional verified improvements:** `Isaiah 61:1` (`D042`, `range@2`: `Matthew 11:5`, `Luke 4:18-19`, `Luke 7:22`, `Matthew 5:3-5`, `Acts 10:38`), `Zechariah 12:10` (`D050`, `range@9`: `Matthew 24:30`, `Acts 2:17-33`, `Revelation 1:7`, `Luke 9:38`), `Genesis 3:15` (`D005`, `range@1`, `paired@1`), `Revelation 13 beast sea horns Daniel 7` (canary: `top10: true`, `[3, 4, 5, 6, 25]` via `r12:scene` `Daniel 7:20`, `Daniel 7:11`, and `r11:xref` `Daniel 7:2-3`), and `Zechariah 4:2` (`r10:xlang:menorah_luchnia` **#1**).

---

## 4. Verification Matrix (Post-Freeze)

- `npm.cmd run check:types` → **PASS** (0 errors)
- `npm.cmd run build` → **PASS** (`1.15s`)
- `node --test research/r12/*.test.mjs` → **PASS** (4/4)
- `node scripts/verify-r12-packed-loading.mjs` → **PASS**
- `node scripts/verify-r12-smoke.mjs` → **PASS** (5/5 smoke checks)
- `node scripts/verify-r11-discovery.mjs` → **PASS** (14/14 checks)
- `node scripts/verify-r11-benchmark.mjs` → **PASS** (30/30 MACULA lemmas `recall=1.0`, `unsupported=0`)
- `node scripts/verify-r12-algorithm-v2.mjs` → **PASS** (`ALL_V2_ALGORITHM_CHECKS_PASSED`)
- `node scripts/verify-r12-mcp-parity.mjs` → **PASS** (8/8 MCP parity assertions, 0 restricted keys)
- **Live Deployments & Probes:**
  - **`bibleresearch-corpus`:** Deployed `Version ID: e44b4b5a-24c2-4bf7-8d88-10762c9e4f3d` (`r12-discovery-3`); **7/7** live RPC probes returned **HTTP 200** (`0%` 503), `X-BibleResearch-Release: r12-discovery-3`, `0` restricted keys. Rollback target: `93de1432-6121-4204-bf69-d6a3c547192e`.
  - **`bible-mcp`:** Deployed **v51** (`verify_jwt: false`, 20 files — preserving live v50 versions of unrelated dirty UX files); **8/8** live `/mcp` `get_Passage` & `get_Word` probes returned **HTTP 200**, `isError=false`, `discovery_status=undefined` (no fallbacks), `0` restricted keys, matching updated discovery rankings. Rollback target: **v50**.

---

## 5. Remaining Weaknesses & Recommended Next Steps

1. **Paraphrase / Non-Cognate Cross-Testament Connections (`S011`, `S039`, `S056`):** Cases lacking shared Strong's, direct LXX overlap `>= 2`, or top-24 OpenBible coverage (e.g., `2 Peter 1:19` *phosphoros* `G5459` vs `Revelation 22:16` *aster ho proinos*; `Genesis 11:9` *balal* `H1101` vs single-LXX `Acts 2:6` *syncheo* `G4797`) remain absent from top 25 (`21/215`). Carefully adding single rare-hapax LXX bridges (`>= 5.0` IDF, strictly capped per verse) is a clean next offline experiment.
2. **Material/Physical Pilot Coverage (`W017`, `W030`):** `r12-pilot` covers `250` anchor lemmas and lacks property bridges for several concrete material lemmas (`H6086` wood, `H1613` gopher wood, Aramaic metallurgy `H1722`/`H3702`/`H5174`/`H6523`). Extending property bridges across concrete nominal taxonomies would directly close `W017` and `W030`.
3. **Standalone Multi-Concept Worker Cold Latency (`three days resurrection`):** Now returns live HTTP 200, but remains near the top of the read envelope (`24` reads / `1873 KB` in eval). Moving Stage 1 ambiguous-token index resolution into a smaller lookup shard would add further headroom.
