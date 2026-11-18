# R12 Live MCP Benchmark — Partial Production Snapshot and Evaluation Handoff

## STATUS UPDATE — 2026-11-19: HTTP 503 / exceededCpu FIXED

**Current incident status: RESOLVED in the complete post-recovery serial benchmark.** On the new Cloudflare Worker `cf2182ed-b3fc-4ab6-99ab-5590e7e8a075` / main MCP v43, **all 239/239 cases returned valid MCP responses** (238 `ok`, one legitimate `no_match` for the unresolved word “yeast”). Across 222 actual live MCP requests, there were **zero observed HTTP 503, other transport errors, or timeouts**. The 164/168 sampled 503 events and 44/60 partial benchmark observations below remain valid **historical findings on the previous deployment**, not the present gateway status. New discovery-quality failures (e.g. disconnected Hagar→ostrich paths) are algorithmic, not infrastructure-related.

**New complete retest:** [Readable report](https://github.com/kingdomfishers/BibleResearch/blob/feat/r12-qa-fixes/research/r12/live_mcp_retest_2026-11-19/R12_MCP_RETEST_REPORT.md) · [All 239 case results, ranked output and source links](https://github.com/kingdomfishers/BibleResearch/blob/feat/r12-qa-fixes/research/r12/live_mcp_retest_2026-11-19/R12_MCP_RETEST_ALL_239.json).

---


**Run:** 2026-11-18, GitHub Actions [44382847987](https://github.com/kingdomfishers/BibleResearch/actions/runs/44382847987), source `research/r12/R12_EXPECTED_CONNECTIONS_180_PLUS.json`.  
**Actual transport:** BibleResearch Supabase MCP Streamable HTTP, JSON-RPC `tools/call` for `discover_biblical_connections_v2`, with each test's original arguments.  
**Status:** **PARTIAL; stopped on a proven production runtime/CPU blocker.** This is not a completed 239-query accuracy evaluation.

## Exact outcomes

| Measure | Count |
|---|---:|
| Benchmark definitions | 239 |
| Queries attempted and persisted | 60 |
| Successful MCP responses with ranked observations | 44 |
| Transport/Worker errors after 3 attempts | 16 |
| Not attempted after CPU safety stop | 179 |
| Preliminary strict textual alias candidates | 28 (NOT verified passes) |
| Cloudflare sampled discovery events | 168 |
| HTTP 503 / `exceededCpu` in sample | 164 |
| Worker CPU shown on failed events | 10 ms |

These are independent measurement types: **60 attempts in the saved benchmark** vs **168 sampled discovery Worker events**, which include retries and other traffic; they must not be added or compared as one denominator.

The first 40 serial MCP calls succeeded. During cases 41–60, 16 attempts failed after retries with `Cloudflare relationship graph gateway HTTP 503`. Cloudflare Worker telemetry confirmed many `exceededCpu` outcomes at the 10 ms CPU boundary. Workflow was cancelled to avoid continued production impact.

## Exact observation files

- `current/manifest.json`: authoritative progress, release, partial status, transport failure cause and sampled telemetry.
- `current/batch_001_020.json`: first 20 queries, 20 successful.
- `current/batch_021_040.json`: next 20 queries, 20 successful.
- `current/batch_041_060.json`: next 20 queries, 4 successful, 16 transport errors.
- `current/review-matrix.csv`: all 239 case IDs with query, expectations, first-ranked evidence, alias candidates, source status and explicit `NOT_RUN_CPU_BLOCK` for the 179 remaining.
- `current/review-matrix.json`: equivalent machine-readable result matrix with category counts.
- Each batch contains the real ordered top-25 MCP discovery records, scores, original-language IDs, witnesses, classifications and limitations. Larger files may not render inline in GitHub; use raw download.

## Early observations (not complete grading)

- `L001`, `H0120` — **Adam–adamah** appears in rank 1 as `r10:wordplay:adam_adamah_gen2_7`. Strong literal/source-backed wordplay candidate.
- `L002`, same `H0120` query — **Adam–dam (H1818)** does **not** appear as its exact Strong's target among the 25 evidence titles/IDs. A simplistic alias check falsely matched the substring `dam` within `adam/adamah`. Rank 24 has a blood/ground interpretation; that is NOT an automatic pass for the intended H0120–H1818 relation.
- `L018`, `H0231` — Hebrew **hyssop → Greek hyssop G5301** LXX bridge appears at rank 9, evidence `r11:lxx:H0231:1`.
- `L020`, `H4682` — Hebrew **matzah → Greek G0106** LXX bridge at rank 10, evidence `r11:lxx:H4682:1`.
- `L027`, `G3088` — **lamp → light-bearer G5459** appears at rank 5, evidence `r12:path:G3088:G5459`. This is a candidate retrieval; 2 Peter 1:19 gives a direct same-verse witness that must be checked in evidence review.
- `L030`, `G1953` — lexical forgetting/forgetfulness and LXX candidate relations appear; interpretation across covenant/James needs source-level evidence review.
- **No complete verdict** is available for narrative-chronology, real-world-material/property/process, or negative controls because the run did not reach those test groups.

## Evaluation rules

**Do not report PASS@K from a text alias.** Inspect the relevant `evidence_id`, the actual target relation, precise witnesses and provenance. Similar spellings, identical words in separate episodes, or generic source/target mentions do not satisfy an intended conceptual connection.

For positives, classify `PASS_AT_K`, `PARTIAL`, `FAIL_AT_K`, `NOT_PRECOMPUTED`, `NO_QUERY_MATCH`, `TRANSPORT_ERROR` or `UNTESTED` separately. For negative controls, classify `PASS_NEG`, `FAIL_NEG` or `INCONCLUSIVE` only after inspecting the claim and epistemic label. An unsupported association labeled exploratory is **not** equivalent to a falsely asserted documented connection.

Use `scripts/review-r12-live-mcp-snapshot.mjs` to recreate a tabular review matrix and add human review fields; it does not treat alias hits as truth.

## Next dependency and prediction

**Do not attempt the remaining 179 queries in a long batch until the production Worker stops returning `exceededCpu`.** Investigate R12 discovery's in-request parse/decompression/graph work, cache and cold-start asset selection; ensure the common request path stays within the currently enforced CPU allocation using compact precomputed per-anchor pages. Keep the existing working release and data intact.

**Acceptance prediction:** After a targeted CPU-safe fix, a one-at-a-time smoke set including `H0120`, `G3088`, `H5869` and `H1285` should return HTTP 200 with no `exceededCpu`. Then resume benchmark collection **only for error/unrun cases** and preserve the existing 44 successful observations as a pinned baseline; track any corpus or MCP release changes. Re-evaluate separately if results were computed under different releases.

Until then, this report is a reproducible **partial observation + confirmed infrastructure blocker**, not a claim about R12's overall precision or recall.
