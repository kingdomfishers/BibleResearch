# R12 — Live MCP benchmark observations

This directory contains machine-readable results from the 239-case expected-connection benchmark.

## Source and status

- Source benchmark: `research/r12/R12_EXPECTED_CONNECTIONS_180_PLUS.json`.
- The collector calls the **actual** Supabase BibleResearch Streamable HTTP MCP endpoint, using `tools/call` with the exact tool and arguments specified in each benchmark case.
- MCP endpoint: `https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp/mcp`.
- The initial `batch_001_010.json` is an **early high-concurrency diagnostic attempt**, with multiple timeouts/503s. **Do not treat its absent responses as discovery failures.**
- The canonical complete (or checkpointed) run is written to `current/manifest.json` and its listed `current/batch_XXX_YYY.json` files by the collector workflow. If `current/manifest.json` does not exist, the full run has **not been verified as started or completed**.

## Canonical result structure

Each saved case records:

| Field | Meaning |
|---|---|
| `case_id` | Exact benchmark case ID (e.g. `S018`, `W032`, `N001`). Join key to reference expectations. |
| `polarity` | Positive connection expected versus negative claim that must *not* be asserted. |
| `query` | Unmodified MCP query arguments; the expected answer is never passed in as a target. |
| `status` | Server status (`ok`, `no_match`, etc.) or `TOOL_ERROR`; distinguish content failure from timeout/503. |
| `attempts`, `previous_errors` | Retry count and transport errors. |
| `release`, `verification_release`, `r12_discovery` | Deployment and corpus release information; vital if a deployment changes mid-run. |
| `top25[]` | Actual ordered top-25 findings; each includes rank, ID, title, summary, classification, witness passages, source identifiers, score components and path steps where available. |
| `target_candidates[]` | Loose alias/ID matches in top K, **only for review**. No automatic semantic PASS. |
| `evidence_probe` | Full evidence-tool followup for the first candidate where available, including source/claim provenance. |
| `triage` | Quick retrieval candidate classification; not a gold relevance label. |
| `review_status` | `UNREVIEWED` until an independent evaluator checks it. |

## Scoring rubric for independent evaluation

For **positive** cases:

- **PASS@K:** A result at rank `<= expected.top_k` actually expresses the expected target relationship or a source-equivalent formulation, AND its detailed evidence supports the typed relation at the claimed epistemic level.
- **PARTIAL:** The expected target is mentioned or an intermediate link exists, but the coherent endpoint bridge or crucial witness is absent.
- **FAIL@K:** A valid response with adequate discovery coverage does not include a qualifying result within K, or promotes a demonstrably false path as authoritative.
- **NOT_PRECOMPUTED / UNCOVERED:** The needed pilot anchor or evidence layer is unavailable; not counted as false historical/biblical assertion.
- **NO_MATCH:** Query resolution returned no match; report separately from absent target after resolution.
- **ERROR:** Tool, transport, timeout or server failure; never mark as retrieval failure or negative scientific result.

For **negative** cases:

- **PASS_NEG:** System does not assert the forbidden interpretation as source-supported. Merely mentioning the topic as explicitly exploratory is permissible.
- **FAIL_NEG:** A forbidden claim is presented as established textual, lexical, physical or theological fact, or a derived external statement masquerades as a source-native statement.
- **INCONCLUSIVE:** Evidence is unavailable or interpretation requires human judgment.

Independently record: first qualifying rank, recall@5/@10/@25, mechanism type, evidence validity, exact verse support, world-source identity checks, weakest epistemic link, result redundancy, and transport failure rates. Report by difficulty (1–5) and category, not just overall success.

**Important:** JSON alias matching cannot establish theological or linguistic relevance. A keyword hit is never automatically a PASS.

## Execute the collector

Workflow: `.github/workflows/r12-live-mcp-snapshot.yml`. Collection script: `scripts/collect-r12-live-mcp-snapshot.mjs`.

The workflow saves and pushes a new batch checkpoint after each 20 queries. A failed or partial run remains diagnosable from the manifest. This is a read-only MCP collection; it does not alter BibleResearch notes, source corpora or production configuration.

For a manual invocation on a machine with Node 22 and network access:

```bash
MCP_CONCURRENCY=2 MCP_BATCH=20 MCP_ATTEMPTS=2 MCP_EVIDENCE=1 node scripts/collect-r12-live-mcp-snapshot.mjs
```

For GitHub: open Actions → **BibleResearch R12 Live MCP 239-Case Snapshot**. Check the run status and its committed `current/manifest.json` rather than assuming that a pushed workflow file means the job executed. The workflow can be dispatched from the repository Actions interface if enabled.
