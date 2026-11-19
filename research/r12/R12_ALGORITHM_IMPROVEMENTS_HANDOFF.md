# BibleResearch R12 — Algorithm Improvements & Live Deployment Handoff (`r12-discovery-2`)

- **Date:** 2026-11-19
- **Role / Owner:** Neon (architecture, implementation, verification & deployment handoff)
- **Target Evaluator:** Independent ChatGPT MCP Evaluation (`@BibleResearch`)
- **Diagnostic Reference:** [R12_BENCHMARK_DIAGNOSIS.md](R12_BENCHMARK_DIAGNOSIS.md) · [R12_BENCHMARK_DIAGNOSIS_239.json](R12_BENCHMARK_DIAGNOSIS_239.json)
- **Checkpoint Reference:** [CHATGPT_CHECKPOINT.md](CHATGPT_CHECKPOINT.md)

---

## 1. Executive Summary

Following the full 239-case diagnosis ([R12_BENCHMARK_DIAGNOSIS.md](R12_BENCHMARK_DIAGNOSIS.md)) and independent audit ([CHATGPT_INDEPENDENT_DISCOVERY_AUDIT_2026-11-18.md](CHATGPT_INDEPENDENT_DISCOVERY_AUDIT_2026-11-18.md)), `r12-discovery-2` / `r12-ranker-v2` was implemented, verified locally and against live endpoints, and deployed across all production services:

1. **Path-level semantic coherence `K` & honest multi-hop classification (`r12-ranker-v2`):** Separated endpoint-level convergence `C` from step-local attestation groups, added `computePathCoherenceK` with intermediate-only hub penalties and unwitnessed-LXX/disjoint-event penalties, pruned incoherent chains (`K < 0.25 && endpoint_support_group_count === 0`), and stopped labeling multi-hop inference paths as `documented_lexical_relationship`. Confirmed incoherent failures `N001–N004` (`Hagar → ostrich`, `eye → angel`, `logos → kidney`, `covenant → wheel`) are eliminated while coherent direct-witness leads such as `G3088 → G5459` (`2 Peter 1:19`, `DIRECT_ENDPOINT_WITNESS`) surface cleanly.
2. **External provenance repair & sense-keyed isolation:** Removed synthetic `wd:related_physical_class` and `wd:combustion_fuel_agent` predicates/GUIDs, enforced strict `/^wd:P\d+$/` and `/^Q\d+\$[0-9a-fA-F-]+$/` Wikidata validation, tagged derived physical claims with `assertion_origin` (`384` assertions, `0` legacy synthetic, `64` mappings), keyed `property-bridges.mjs` by `sense_id` (`H5869_eye` vs. `H5869_spring`), and distinguished `external_concept_equivalence` vs. `shared_external_property` while keeping `independent_biblical_support === 0`.
3. **Passage intertext, chronological events & hijack prevention:** Embedded top-20 bidirectional `r10/xrefs` across `30,022` verses (`392,281` links) and Theographic `events` across `6,423` verses directly inside the existing `488` `fast-verses/chunk-*.json.gz` files (zero extra files) plus `event_seq` / `event_by_chapter` inside `motifs-and-patterns.json.gz`. Blocked single coincidental Strong's matches from triggering unrelated Tier-1 `explicit-and-typology` records (`Exodus 12:15` no longer hijacked by `rev5_6_eyes_spirits`; `Genesis 1:1` no longer hijacked by `1cor10_1_2`).
4. **Concept resolution & numeral guards:** Added `22` modern English synonym/phrase lookup keys (`+102` entries) into `fast-profiles` plus Stage-1 3-gram/2-gram phrase and stem/alias resolution (`"yeast"` now resolves `status: "ok"` to `G2219`/`H2557`/`H7603`), and guarded `r11:intersect:verse` against compound-magnitude numerals (`"three days resurrection"` no longer surfaces Genesis 5:23 / `365 years`).
5. **Unified compiler & 250-anchor expansion:** Unified `research/r12/proof-ranker.mjs` over `src/relationships/path-ranker.ts`, expanded `r12-pilot` systematically from `48` to **`250`** anchors (`48` core + `202` expanded), enforced `minDistinctFamilies: 2` (`717` multi-family structural scenes) and distinct-root co-occurring orthographic candidates (`1,994` pairs, surfacing `r12:orth:H0120:H1818`), and packed everything within Cloudflare's `20,000`-file limit.

> **Important evaluation boundary:** We intentionally did **not** re-run the full 239-case live MCP benchmark. Only local targeted/regression suites and bounded live HTTP + serial MCP probes ran so that ChatGPT can execute an independent 239-case re-evaluation against the live deployment.

---

## 2. Live Deployment Provenance & Rollback References

| Component | Production Endpoint | New Live Version / Release | Previous Rollback Target |
|---|---|---|---|
| **Corpus Worker** (`bibleresearch-corpus`) | `https://bibleresearch-corpus.kingdomfishers-custom.workers.dev` | Version ID `cce819e9-60d4-4e17-bb01-ed138af9a9a3`<br>`R12_RELEASE_ID`: `r12-discovery-2`<br>`R12_ASSET_SHA256`: `7a08727be4d841e4aded1f0aeb5300c9d79e32769d30ba1968726d413f630a11`<br>`R12_SOURCE_COMMIT`: `d9940058651c83befa168a2f31e60fca0c691414`<br>(`752` uploaded / `19,248` already uploaded; `20,000` bundle files) | `cf2182ed-b3fc-4ab6-99ab-5590e7e8a075`<br>(`85605ac`, `r12-discovery-1`, SHA `a0715c17a2641b6acf0053695dd9aeb2c153400c71d730ee00201e4a06ccd17b`) |
| **Website Worker** (`bibleresearch`) | `https://bibleresearch.kingdomfishers-custom.workers.dev` | Version ID `3d9482f4-7309-4fe5-babf-140041f5b42a`<br>(`/index.html` + `/assets/index-DE_Hug0S.js`) | `d147114c-6a5c-4927-80ed-2a48877c2af4` |
| **Main MCP Server** (`bible-mcp`, Supabase `ejoperxiwxlcbsqrkrvb`) | `https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp/mcp` | **Version `44`** (`ACTIVE`, `verify_jwt: false`, `import_map: true`)<br>`version: "1.8.0"`, `tools: 46`, `prompts: 22`, `writes: "enabled"`<br>`ezbr_sha256`: `7560b097c4e5fc3fbfe94bf557f036e58a5ddbf6b8cc278c075731105adfac71` | **Version `43`** (`1.7.0`, `46` tools, `22` prompts) |

*Note on API compatibility:* `DEFAULT_R10_RELEASE` remains `'r11-v1.0'` for packed asset paths and R11 backward compatibility, while live R12 discovery packets report `verification_release.corpus_release: "r12-discovery-2"` and `r12_metadata.score_version: "r12-ranker-v2"`.

---

## 3. Root Causes Addressed & Implementation Summary

| Root Cause | Files Changed | Key Mechanism Implemented |
|---|---|---|
| **RC-1 / RC-2** Multihop epistemic overstatement, `C=1` inflation, missing coherence `K` | `src/relationships/multihop-types.ts`, `src/relationships/path-ranker.ts`, `research/r12/proof-ranker.mjs` | Added `computePathCoherenceK`, intermediate-only hub penalty, endpoint convergence `C` separated from step-local groups, `DIRECT_ENDPOINT_WITNESS` / `COHERENT_MULTIHOP_LEAD` / `EXPLORATORY_STEP_CHAIN` status, pruning of dead chains (`K < 0.25 && endpoint_support_group_count === 0`), and unified TypeScript ranker delegation. |
| **RC-5** Fabricated Wikidata predicates & `anchor_id` sense bleed | `scripts/acquire-r12-external-pilot.mjs`, `scripts/fixtures/r12-external-pilot.json`, `research/r12/property-bridges.mjs` | Removed synthetic `wd:related_physical_class` & `wd:combustion_fuel_agent`; enforced strict Wikidata regex validation + `assertion_origin` (`384` assertions, `0` legacy synthetic, `64` mappings); indexed bridges by `sense_id` (`bySense`) and labeled `external_concept_equivalence` vs. `shared_external_property`. |
| **RC-7** Structural feature triplication | `research/r12/structural-candidates.mjs`, `scripts/build-r12-pilot.mjs` | Required `minDistinctFamilies: 2` across independent feature families (`717` multi-family scenes compiled). |
| **RC-3** Passage queries ignore `r10/xrefs` & `events`; 1-token typology hijacks | `scripts/pack-r12-cpu-safe-assets.mjs`, `src/relationships/r10-discovery.ts` | Embedded top-20 bidirectional xrefs (`30,022` verses, `392,281` links) and events (`6,423` verses) into existing `488` `fast-verses` chunks + `event_seq` / `event_by_chapter`; guarded `explicit-and-typology` against single coincidental Strong's matches on passage queries. |
| **RC-6** Synonym/phrase gaps & numeral collisions | `scripts/pack-r12-cpu-safe-assets.mjs`, `src/relationships/r10-discovery.ts` | Added `22` modern English synonym/phrase lookup keys (`+102` entries) in `fast-profiles`, runtime 3-gram/2-gram + stem/alias matching, and compound-magnitude numeral guard on `r11:intersect:verse`. |
| **RC-4** Runtime score imbalance, truncated `orth`, `mode: "bridge"` no-op | `src/relationships/r10-types.ts`, `src/relationships/r10-discovery.ts`, `research/r12/orthographic-candidates.mjs`, `src/ui/components/DiscoverConnections.ts` | Checked `DIRECT_ENDPOINT_WITNESS` (Tier 4) before `isHypothesis`; filtered `r11:gram` pronouns/auxiliaries; elevated `r11:lxx`, `r11:lex`, `r11:colloc`, and distinct-root co-occurring `r12:orth` (`1,994` pairs, removing `.slice(0,2)` truncation); implemented `mode === 'bridge'` bonus & mechanism-family diversification; surfaced `K`, `endpoint_epistemic_status`, and `bridge_kind` in UI. |
| **RC-8** 48-anchor ceiling, duplicate ranker, MCP schema currency | `scripts/build-r12-pilot.mjs`, `integrations/plugin.json`, `supabase/functions/bible-mcp/*` | Expanded pilot from `48` to `250` systematic anchors using TS ranker directly; fixed `endpointCtxCache.get(pairKey)` & `r10-b64gz-1` decoding; bumped MCP workflow/plugin to `1.8.0` preserving `46` tools & `22` prompts. |

---

## 4. Before / After Verification Summary

### 4.1 Local Test & Build Suites (All Exited `0` After Code Edits)

- `npm.cmd run check:types` (`tsc --noEmit`) — exit `0`
- `npm.cmd run build` (`vite build`, 104 modules) — exit `0`
- `node --test research/r12/proof-ranker.test.mjs research/r12/property-bridges.test.mjs research/r12/structural-candidates.test.mjs research/r12/orthographic-candidates.test.mjs` — `4/4` suites pass (`0` fail, `0` skipped)
- `node scripts/verify-r12-smoke.mjs` — `5/5` pass
- `node scripts/verify-r12-packed-loading.mjs` — `PASS` (`total_files: 20,000`, `pilot_compaction_parity: PASS`, `fast_profiles_max_outer_bytes: 234003`, `fast_verses_max_outer_bytes: 79889`)
- `node scripts/verify-r11-discovery.mjs` — `14/14` pass
- `node scripts/verify-r11-benchmark.mjs` — `30` lemmas `recall: 1`, `15` pairs `unsupported: 0`
- `node scripts/verify-r12-algorithm-v2.mjs` — `ALL_V2_ALGORITHM_CHECKS_PASSED`, `0` restricted keys (`l027_rank: 11`, `l002_rank: 11`, `w025_status: "ok"`, `r12:path:G3088:G5459` `2 Peter 1:19`, all 7 evidence prefixes hydrated)

### 4.2 Bounded Live HTTP & Serial MCP Verification (`bible-mcp` v44 + Corpus `cce819e9`)

All live HTTP and serial JSON-RPC checks returned **`0` HTTP 500/503/errors** and **`0` restricted JSON keys**:

- `/__integrity/b7` -> HTTP `200`, `PASS_CANARIES`, `X-BibleResearch-Release: r12-discovery-2`, `X-BibleResearch-Assets: 7a08727be4d841e4aded1f0aeb5300c9d79e32769d30ba1968726d413f630a11`
- `/v1/catalog/metadata.json.gz` -> HTTP `403` (restricted catalog remains blocked)
- `https://bibleresearch.kingdomfishers-custom.workers.dev/` -> HTTP `200`
- `https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp/health` -> HTTP `200` (`version: "1.8.0"`, `tools: 46`, `prompts: 22`, `writes: "enabled"`)
- `get_verse_research` on Genesis `1:2` (`profile: "analysis"`) -> `status: "ok"`, `verses_count: 1`, `words_count: 14`, `has_notes_map: true`, `chronology_present: true`, `geography_present: true`

| Probe / Case | Before (`r12-discovery-1`, MCP v43) | After Live (`r12-discovery-2`, MCP v44, `bibleresearch-corpus` `cce819e9`) |
|---|---|---|
| **N001 (`H1904` Hagar)** | Rank #3 `r12:path:H1904:H3284` (`documented_lexical_relationship`, Hagar → ostrich) | **Incoherent path absent**; top-5 are `r11:gram:H1904:grammatical_subject_of:H3205` (1008), `r11:lxx:H1904:0` (971), `r11:lex:H1904:0` (951), `r11:cluster:H1904:historical_narrative` (781), `r11:xref:383:523` (771). |
| **N002 (`H5869` eye)** | Rank #5 `r12:path:H5869:G0032` (`documented_lexical_relationship`, eye → angel) | **Incoherent `G0032` path absent**; coherent neighbors led by `r10:ident:rev5_6_eyes_spirits` (1159), `r10:homograph:ayin_eye_vs_spring_h5869` (936), `r12:path:H5869:H6440` (911, `documented_collocation_or_cooccurrence`). |
| **N003 (`G3056` logos)** | Rank #4 `r12:path:G3056:H3629` (`documented_lexical_relationship`, logos → kidney) | **Incoherent `H3629` path absent**; top-5 `r12:path` (`G0435`, `G4102`, `G3049`, `G2036`, `G4487`, score 900–911) all classified `documented_collocation_or_cooccurrence`. |
| **N004 (`H1285` covenant)** | Rank #2 `r12:path:H1285:H0212` (`documented_lexical_relationship`, covenant → wheel) | **Incoherent `H0212` / `H1534` paths absent**; top-5 `r12:path` (`H5715`, `H5927`, `H3772`, `H7235`, `H7843`, score 898–903) classified `documented_collocation_or_cooccurrence`. |
| **L027 (`G3088` lamp)** | Missing direct `2 Peter 1:19` witness; paths mislabeled `documented_lexical_relationship` | `r12:path:G3088:G5459` at **Rank #11** (`score 902`, `documented_collocation_or_cooccurrence`); live `get_connection_evidence_v1` confirms `score_version: "r12-ranker-v2"`, `endpoint_epistemic_status: "DIRECT_ENDPOINT_WITNESS"`, `passage_details_length: 3`. |
| **L002 (`H0120` adam)** | `r12:orth:H0120:H1818` hidden by `.slice(0,2)` cap | `r12:orth:H0120:H1818` live at **Rank #11** (`score 800`, `orthographic_similarity_only`), promoted ahead of un-cooccurring forms. |
| **S001 (`Exodus 12:15`)** | Hijacked at Rank #1 by `r10:ident:rev5_6_eyes_spirits` | **`rev5_6` hijack eliminated**; `r11:xref:1832:29274` (`Galatians 5:12`) at **Rank #6** (`score 915`), chronological events `r12:event:1832:event:74` (`Genesis 13:1`) & `r12:event:1832:event:125` (`Exodus 13:18`) at **Ranks #13–14** (`score 885`, `direct_textual_evidence`), `r11:xref:1832:4595` (`Numbers 28:17`) at **Rank #19** (`score 845`). |
| **S018 (`Hosea 6:2`)** | Missed `1 Cor 15:4` reciprocal xref in top-K | `r11:xref:22286:28823` (`1 Cor 15:4`, `verified_cross_reference`) surfaced live at **Rank #4** (`score 915`). |
| **W025 (`yeast`)** | `status: "no_match"` (`0` results) | `status: "ok"`; top-3 `r11:gram:G2219:possessive_construction_with:G5330` (1006), `r11:gram:H2557:grammatical_object_of:H0398` (1003), `r11:lxx:H7603:0` (978). |
| **N009 (`three days resurrection`)** | Rank #1 `r11:intersect:verse:H7969:H3117:129` (Genesis 5:23, Enoch's 365 years) | **Genesis 5:23 / `365 years` absent** from top-12; top-4 are Gen 7:13, 30:36, 40:12, 40:13 + `G5140`/`G2250`. |
| **N017 / `H2091` (`r12:prop:G3088:H4501`)** | Synthetic `wd:combustion_fuel_agent` & `wd:related_physical_class` claims | Live `get_connection_evidence_v1("r12:prop:G3088:H4501")` returns `status: "ok"`, `epistemic_class: "external_world_bridge"`, `bridge_kind: "shared_external_property"`, `independent_biblical_support: 0`, `passage_details_length: 4`, clean `external_bridge` provenance fields. |
| **D001 (`Genesis 1:1`)** | Dominant `1cor10_1_2` noise & missing direct NT creation echoes | `1cor10_1_2` hijack absent; `r10:corresp:gen1_to_rev4_rev21_creation_spirits` at #1 (`1015`), grammatical/LXX core in top-5, `r12:event:1:event:1` at #11 (`885`). |

---

## 5. Instructions for Independent ChatGPT Re-Evaluation

1. **Refresh the `@BibleResearch` MCP connector schema** in ChatGPT so updated tool descriptions (`r12-discovery-2 / r12-ranker-v2`, `version: 1.8.0`) are active.
2. **Verify health & release provenance:**
   - Call `get_relationship_coverage_v2({})` or inspect `verification_release` inside any `discover_biblical_connections_v2` response; expect `mcp_release: "1.8.0"`, `corpus_release: "r12-discovery-2"`, `worker_version: "cce819e9-60d4-4e17-bb01-ed138af9a9a3"`, `asset_sha256: "7a08727be4d841e4aded1f0aeb5300c9d79e32769d30ba1968726d413f630a11"`.
3. **Run the independent 239-case benchmark** against [R12_EXPECTED_CONNECTIONS_180_PLUS.json](R12_EXPECTED_CONNECTIONS_180_PLUS.json) serially (no concurrency spikes) via `discover_biblical_connections_v2`, plus targeted `get_connection_evidence_v1` checks on:
   - Former negative failures: `H1904` (`N001`), `H5869` (`N002`), `G3056` (`N003`), `H1285` (`N004`), `"three days resurrection"` (`N009`), `r12:prop:G3088:H4501` (`N017`), `r12:struct:*` (`N024`).
   - Recovered positives: `"yeast"` (`W025`), `"Hosea 6:2"` (`S018`), `"Exodus 12:15"` (`S001`), `"G3088"` (`L027` + `r12:path:G3088:G5459`), `"H0120"` (`L002` + `r12:orth:H0120:H1818`), `"Genesis 1:1"` (`D001`), and `"bridge"` mode checks (`discover_biblical_connections_v2({ query: "H2091", mode: "bridge" })`).

---

## 6. Remaining Known Limitations

1. **Full 239-case post-deployment precision/recall score not yet measured:** Only local targeted/regression checks and bounded live probes ran before handoff; full benchmark grading awaits ChatGPT's independent run.
2. **250-anchor pilot ceiling:** Multi-hop path precomputation and external physical-property linking expanded from `48` to `250` systematic anchors, not every lemma in the ~22k STEP vocabulary.
3. **Curated external property extract (`64` mappings / `384` assertions):** Wikidata/OEWN coverage remains bounded to the cleaned pinned extract rather than an unbounded live SPARQL index.
4. **Canary integrity scope (`/__integrity/b7`):** Verifies two regression alignment canaries only (`complete_corpus_verified: false`).
5. **17 passage-seeded benchmark cases without direct 1-hop `r10/xrefs`:** Rely on chronological event sequencing (`r12:event:*`) or 2-hop/motif paths and should be graded carefully as candidate parallels where explicit xrefs do not exist.
