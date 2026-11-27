# V3 Discovery Recovery & Root Cause Analysis

## 1. Git Source-to-Deployment Parity

- **Problem identified:** GitHub `origin/feat/r12-qa-fixes` stopped at `b3c8926` (ahead of `838da3d8`), while production `bibleresearch-corpus` reported `R12_SOURCE_COMMIT = 6f70561b5487e5d1033cdd72fd9578ed8e63f239` (a local pre-amend commit before `62ef168` `r13-discovery-3`), followed locally by `0451b1a` (Research KG) and uncommitted v3 runtime changes.
- **Resolution:** Preserved the entire pre-recovery v3 working state on local Git branch `archive/v3-pre-recovery-20261127` before applying recovery changes, then committed recovered code + docs on `feat/r12-qa-fixes`, synchronized `wrangler.corpus.jsonc` `R12_SOURCE_COMMIT` to that commit SHA, and pushed `origin/feat/r12-qa-fixes` prior to live deployment.

## 2. Production Availability Root Causes (`HTTP 503 Worker exceeded resource limits`)

Cloudflare Workers Free enforces a strict **10 ms CPU budget per request**. Live probes before recovery returned `HTTP 503 Worker exceeded resource limits` across all tested `discover_biblical_connections_v2` (`Isaiah 55:8-13`, `Zechariah 4`, `Genesis 6:14`, `Numbers 21:8-9`, `almond watch lampstand`) and `discover_subgraph_v1` (`Numbers 21:8-9` + `John 3:14-15`, `Zechariah 4` + `Revelation 11`, `almond` + `watch` + `lampstand`) requests.

Root causes isolated via `verify-r12-worker.mjs --mode v3` and Git diff inspection (`838da3d8` -> `62ef168` -> `0451b1a` -> uncommitted v3):

1. **Inline v3 verification inside default discovery (`src/relationships/r10-discovery.ts`):** `discoverBiblicalConnections` unconditionally executed `runV3DiscoveryAndVerification` even on normal passage/connection lookups (~14 ms handler CPU in local `workerd`). Gated `runV3DiscoveryAndVerification` behind explicit `query.include_v3_verification && !query.skip_v3_verification` so default `discover_biblical_connections_v1/v2` runs in `r13-discovery-3` ~3–4 ms budget while keeping `v3` specialized ops (`lxx_concordance_v3`, `tri_textual_diff_v3`, `clause_role_query_v3`, `sequence_parallels_v3`, `wordplay_scan_v3`, `set_combine_v3`, `expand_clue_v3`) directly available.
2. **Removed `lite_subgraph_mode: true` & inline CSR/PPR augmentation (`src/relationships/subgraph-engine.ts`):** Removing `lite_subgraph_mode: true` on per-anchor and combined calls plus running `augmentSubgraphWithV3PprAndCsr` inline pushed `discover_subgraph_v1` to `~103 ms` CPU in `workerd`. Restored `lite_subgraph_mode: true` (`perAnchor` `limit: 10`, `combined` `limit: 16`, `max_edges: 110`), trimmed heavy `convergenceTargetKeyFor` / `postSnippetReads` / cluster-bridge work during `lite_subgraph_mode`, and gated `augmentSubgraphWithV3PprAndCsr` behind `request.include_v3_ppr`.
3. **Reduced Worker LRU shard cache (`scripts/corpus-worker.mjs`):** Cache caps had been lowered from `256 shards / 16 MiB / 2 MiB max entry` to `64 shards / 10 MiB / 512 KiB`, evicting hot compressed shards (`semantic-ontology`, `motifs-and-patterns`, `profiles`) and causing repeated gzip/JSON decode CPU spikes. Restored `256 / 16 MiB / 2 MiB` while retaining `/v3/*` Range hooks.
4. **Silent failure masking in MCP (`supabase/functions/bible-mcp/discovery-v2-tools.ts`):** `handleGetPassage` returned `status: 'ok'` in both `clues` and full views even when `discPages` failed (`discoveryPartial = true`). Exposed `status: 'partial'`, `discovery_status: 'partial'`, and explicit unavailable warning whenever upstream discovery fails.

## 3. Retrieval, Ranking, and Subgraph Regressions Resolved

1. **First-verse bias on multi-verse/chapter passages (`src/relationships/r10-discovery.ts` & `supabase/functions/bible-mcp/discovery-v2-tools.ts`):**
   - `r10-discovery.ts` previously hydrated only `ep.verse` (e.g., verse 8 of `Isaiah 55:8-13`, missing Isaiah 55:10-11 rain/snow/word; verse 1 of `Zechariah 4`). Replaced with whole-span/whole-chapter hydration (`MAX_EXPLICIT_SPAN_VERSES = 14` with even stride sampling on >14-verse chapters), merged `xrefs`/`eventIds`/`scenes` across hydrated verses, and round-robined `passageContentStrongs` across all span verses (`profileSliceLimit` up to `7`).
   - `handleGetPassage` in `clues` mode previously queried only `firstRef` when `versesRaw.length > 3`; updated to query full `rangeRef` across the requested passage slice.
2. **Whole-chapter terminal mismatch in Steiner subgraphs (`src/relationships/subgraph-engine.ts`):**
   - `anchorRanges` previously used `vEnd: Number(ep.end_verse ?? ep.verse ?? 1)`. Chapter anchors without `:` (e.g., `Zechariah 4`, `Revelation 11`) defaulted to `vStart=1, vEnd=1`, preventing chapter body verses (`Zechariah 4:2`, `Revelation 11:4`) from matching terminal anchors and yielding `paths=0`. Added `isWholeChapter = !String(ep.ref).includes(':')` (`vStart=1..200`) and range-based focal lemma matching.
3. **Redundant single-channel cards vs. multi-evidence convergence (`src/relationships/r10-discovery.ts`):**
   - Added `convergenceTargetKeyFor` deduplication so multiple independent signals targeting the same target lemma/verse (e.g., editorial xref + lexical/LXX + motif) consolidate onto one primary card with a bounded convergence bonus (`+14` per corroborating family, max `+28`) and a `"Convergent evidence:"` summary (skipped under `lite_subgraph_mode`).
4. **Statistical rarity dominance (`src/relationships/r10-discovery.ts`):**
   - Updated `scoreCandidatesR13` so raw rarity `P` is capped at `0.75` unless corroborated by an explicit textual/lexical evidence axis (`hasStrongEvidenceAxis`), preventing rare hapax/proper-name collisions from outranking explicit textual and cross-language connections.
5. **Preserved v3 capabilities & shared architecture:**
   - Kept MCP `3.0.0` progressive `clues` disclosure (`handleGetConnection` `clues` cap raised `5 -> 8`), v3 research ops (`lxx_concordance`, `tri_textual_diff`, `clause_role_query`, `sequence_parallels`, `wordplay_scan`, `set_combine`, `expand_clue`), `epistemic-taxonomy.ts` (`G3588` article filter, `Amos H5986 <-> H5971` negative control, reciprocal xref collapse, `Numbers 21:4-9 <-> John 3:14-15` Moses hub penalty & range anchor matching), and identical `discover_biblical_connections_v2` / `discover_subgraph_v1` backend routing for Website (`src/api/corpus-client.ts`, `src/api/r10-rpc.ts`) and MCP (`bible-mcp`).

## 4. Focused Local Verification (`verify-discovery-recovery.mjs`, `workerd` v3 mode)

| Diagnostic Query / Proof | Stage 1 (Pre-Rank) | Stage 2 (Worker Post-Rank) | Stage 3 (MCP `clues`) | Status |
| :--- | :--- | :--- | :--- | :--- |
| `Isaiah 55:8-13` | `Isa 55:12 ↔ Isa 44:23`, `יָרַד ↔ יָלַד`, `Isa 55:12 ↔ Rom 15:13` | `יָרַד ↔ יָלַד`, `Rom 15:13`, `Isa 44:23`, `Isa 55:10 ↔ Isa 30:23 ("rain")` | `status=ok`, `Isa 55:10 ↔ Isa 30:23 ("rain")` preserved | PASS |
| `Zechariah 4` | `zech4_menorah_oil_spirit_eyes`, `menorah_luchnia` (`H4501 ↔ G3087`) | `zech4_menorah_oil_spirit_eyes`, `menorah_luchnia`, `Zech 4:2` self-interp, `exod25_to_zech4_menorah_oil` | `status=ok`, core menorah/oil/LXX clues preserved | PASS |
| `Genesis 6:14` | `Gen 6:14 ↔ 1 Pet 3:20`, `Gen 6:14 ↔ Exod 2:3 ("pitch")` | `1 Pet 3:20`, `Exod 2:3 ("coat it with pitch")`, `Mat 24:38` | `status=ok`, `Exod 2:3` & `1 Pet 3:20` preserved | PASS |
| `Numbers 21:8-9` | `Num 21:9 → John 3:14-15`, `נָחָשׁ ↔ נְחֹשֶׁת`, `2 Kgs 18:4` | `נָחָשׁ ↔ נְחֹשֶׁת`, `John 3:14-15`, `2 Kgs 18:4`, `1 Cor 10:9` | `status=ok`, `John 3:14-15` & `נָחָשׁ ↔ נְחֹשֶׁת` preserved | PASS |
| `almond watch lampstand` | `Exod 25:34` (`H8246+H4501`), `Exod 37:20`, `Exod 25:33` | `Exod 25:34`, Temple Architecture, `שָׁקֵד ↔ שָׁקַד` (`H8247↔H8246`) | `get_Connection(H8247,H8245,H4501)` `status=ok`, `H8247↔H8245` wordplay & Steiner path | PASS |
| Negative control (`zzr12noattestation`) | `[]` | `[]` | `status=ok`, `[]` | PASS |
| Subgraph `Num 21:8-9 + John 3:14-15` | — | `paths=1`, HTTP `200` | `gcStatus=ok`, proof=`passage_lxx:H5175:G3789` (`נָחָשׁ ↔ ὄφις`) | PASS |
| Subgraph `Zechariah 4 + Revelation 11` | — | `paths=1`, HTTP `200` | `gcStatus=ok`, proof=`r10:xlang:menorah_luchnia` (`Zech 4:2 ↔ Rev 11:4`) | PASS |
| Subgraph `almond + watch + lampstand` | — | `paths=1`, HTTP `200` | `gcStatus=ok`, `paths=1` | PASS |
| Wordplay negative `H5986 ↔ H5971` | — | `attested_textual_wordplay: false`, `wordplay_candidate: false` | — | PASS |

Local gate checks: `verify-r12-worker.mjs --mode v3` (`0` HTTP errors, `0` HTTP 1102), `verify-corpus-security.mjs` (`PASS`, `19` assertions), `verify-research-workflow.mjs` (`PASS`, `26` rubrics), `tsc --noEmit` (`0`), and `vite build` (`0`).

## 5. Post-Deploy Cold & Warm CPU Hardening

Live Cloudflare Free (`ZRH` PoP) verification after the initial deploy surfaced cold-isolate `HTTP 503 Worker exceeded resource limits` (`1102`) bursts when requests loaded large uncached assets or enumerated excessive candidates. Profiling `discoverBiblicalConnections` and `workerd` CPU traces isolated and fixed the following remaining hotspots:

- **Bounded E2 cross-reference & target hydration (`src/relationships/r10-discovery.ts`):** Scaled `e2SliceLimit` inversely with passage span length (`max(4, ceil(36 / verses))` vs `28` per verse) and replaced the per-verse hydration quota (`4` per verse) with a global cap (`2` total on passage-only queries, `1` on mixed), preventing `555`-candidate explosions on chapters like `Zechariah 4`.
- **Response payload size bounds (`src/relationships/r10-discovery.ts`):** Capped `clusters` (`6`), `bridges` (`8`), `connection_paths` (`8`), and `related_discoveries.cross_references` (`20`), reducing full JSON responses from up to `440 KB` (`Zechariah 4`) / `301 KB` (`Isaiah 55:8-13`) and keeping serialization well inside Cloudflare Free limits.
- **Lazy `motifs-and-patterns.json.gz` & genealogy fallback (`src/relationships/r10-discovery.ts`, `src/relationships/subgraph-engine.ts`):** Avoided cold `827 KB` gzip (`1.37 MB` JSON) decodes in `E2` unless `motifsData` is already loaded, and gated `subgraph-engine.ts`'s `genealogy_index_b64gz` check to lexical/person subgraphs lacking direct inter-anchor edges.
- **`resolveDisplaySense` early exit & `lite_subgraph_mode` Tier-5 trim (`src/relationships/r10-discovery.ts`):** Bounded `prof.forms` scanning (`max 80` scanned / `6` matched instead of scanning 550+ forms per candidate) and skipped Tier-5 `r12PropertyBridgeToRecord` / optional orthographic expansion during `lite_subgraph_mode`.
- **Native async gzip streaming & LRU ceiling (`scripts/corpus-worker.mjs`):** Restored `MAX_SINGLE_LRU_BYTES = 4 MiB` and `DecompressionStream('gzip')` for compressed shards `>= 32 KB`.
- **Warm `A–D2` loop & hoisted sense optimization (`src/relationships/r10-discovery.ts`):** Hoisted `profDefaultSense` per loaded profile for passage-only and `lite_subgraph_mode` queries; skipped cluster (`A`/`E`), collocation (`D2`), and neighbor xref scans (`pericopeNeighbors`) under `lite_subgraph_mode` and >4-verse spans; bounded `prof.clusters` (`2` passage / `4` lexical), `B–D` per-profile candidates (`4` each), `D2` (`2` targets), `profileSliceLimit` (`4` passage / `3` lite subgraph), and `matchingForms` early exit (`<= 60` scanned / `3` matched). Local `workerd` v3 benchmark dropped `discover_subgraph_v1` handler CPU from `548.7 ms -> 57.0 ms` (`burst p95 6761 ms -> 217 ms`), `v3_cpu_handler_per_req_p50_ms = 2.768 ms`, and `all_cpu_handler_per_req_p50_ms = 2.918 ms` (`0` HTTP errors, `0` HTTP 1102).
- **128 MB isolate memory cap hardening (`scripts/corpus-worker.mjs`, `src/relationships/r10-discovery.ts`):** Keeping `16 MiB` of parsed JSON in `shardLru` plus `36` v3 binary caches expanded V8 parsed JS objects toward Cloudflare's `128 MB` isolate memory limit on back-to-back multi-verse/subgraph batches. Bounded `shardLru` (`64` shards / `6 MiB` JSON / `2 MiB` max single entry), `v3` binary/record caches (`MAX_V3_BINARY_ENTRIES = 8`, `MAX_V3_RECORDS = 512`, `MAX_V3_LRU_BYTES = 4 MiB`), and `SENSE_STEMS_CACHE` (`512`), achieving `v3_cpu_handler_per_req_p50_ms = 2.581 ms` (`p99 = 8.542 ms`) and `discover_subgraph_v1 = 53.411 ms` (`burst p95 = 144.6 ms`) with `0` HTTP 1102.

