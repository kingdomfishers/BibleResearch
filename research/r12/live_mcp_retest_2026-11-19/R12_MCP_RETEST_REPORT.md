# BibleResearch R12 — Complete Post-Recovery MCP Retest

**Date:** 2026-11-19 (Europe/Zurich)  
**Benchmark:** `research/r12/R12_EXPECTED_CONNECTIONS_180_PLUS.json` (unchanged; 215 positive + 24 negative controls).  
**Status:** **COMPLETE as an execution/retrieval snapshot; evidence-quality grading still requires manual or independent semantic assessment.**  
**Transport:** connected **@BibleResearch MCP** `discover_biblical_connections_v2` using the benchmark's exact `query`, `limit=25`, `max_hops=5`, and `mode`. No synthetic results and no direct Cloudflare RPC substitution.

## 1. Infrastructure verdict: 503 recovery confirmed in full serial run

| Measurement | Fresh full retest |
|---|---:|
| Cases in benchmark | **239** |
| Cases with an MCP response | **239** |
| Responses `status:"ok"` | **238** |
| Responses `status:"no_match"` | **1** (`W025` “yeast”; unresolved query) |
| MCP transport errors / HTTP 503 / timeouts observed | **0** |
| Actual MCP network calls (within-batch deduplication) | **222** |
| Different query argument payloads across all cases | **190** |
| Observed request latency median | **1,062 ms** |
| Observed request latency P95 | **2,617 ms** |
| Observed request latency maximum | **3,719 ms** |

**Deployed versions:** Cloudflare corpus Worker `cf2182ed-b3fc-4ab6-99ab-5590e7e8a075`, Supabase `bible-mcp` v43, release `r12-discovery-1`. These were already deployed by the runtime-recovery commit `579cd49a720ee69f01f85cb7c334918d64f71ea2`. No discovery algorithm or backend code was modified for this retest.

**Old incident was real but is now resolved in this observed sample.** On 2026-11-18 the original run completed 44/60 with 16 failures; Cloudflare telemetry showed 164/168 discovery events with `exceededCpu` and HTTP 503. This 2026-11-19 rerun passed its full MCP transport/execution coverage. Do not erase or rewrite the older observations; add this note as a *superseding status*. Serial success does not guarantee all possible concurrent/cold loads.

## 2. Exact result files and evaluation contract

**One machine-readable, one-row-per-case consolidated matrix:**

`research/r12/live_mcp_retest_2026-11-19/R12_MCP_RETEST_ALL_239.json`

Each row stores:

- Stable case ID, query arguments, expected target and biblical witnesses, difficulty and mechanism.
- Actual live MCP status and response time, active discovery release, and pilot coverage.
- **All top-five** evidence titles/IDs/scores and source references for quick triage.
- Candidate matches within each case's expected top-K window, with ranks and matched aliases.
- Pointer to the **numbered full-detail batch** containing the complete top-25 ordered results, evidence IDs, original-language Strong's IDs, claimed epistemic class, source passages, summaries and selected source text snippets.

Full-detail batches: `batch_001_020.json`, `batch_021_030.json`, `batch_031_045.json`, `batch_046_060.json`, `batch_061_075.json`, `batch_076_090.json`, `batch_091_105.json`, `batch_106_120.json`, `batch_121_135.json`, `batch_136_150.json`, `batch_151_165.json`, `batch_166_180.json`, `batch_181_195.json`, `batch_196_210.json`, `batch_211_225.json`, `batch_226_239.json`.

Large batch files over 1 MiB may appear empty in GitHub Contents API but are correctly committed blobs; use the GitHub blob/raw API to inspect them.

### Scoring caution

**A keyword/alias match is not a PASS.** A term may be returned as a source word, a generic motif, or another context entirely.

Preliminary candidate retrieval only:

| Type | Potential alias in top-K | No alias found in top-K | Query unresolved |
|---|---:|---:|---:|
| Positive expectations (215) | **146** | **68** | **1** |
| Negative controls (24) | **9** flagged for inspection | **15** without alias | 0 |

These numbers measure a **cheap candidate filter, not semantic precision or recall**. False positive alias matches are known, e.g. the `dam` string inside `a.dam`; an indirect paraphrase may be missed by a string filter. **Do not present 146/215 as the discovery PASS rate.**

To adjudicate a positive, inspect the candidate's `get_connection_evidence_v1`, check that the target relationship (not just target word) is supported and epistemic status is appropriate. Mark `PASS_AT_K`, `PARTIAL`, `FAIL_AT_K`, `COVERAGE_GAP` or `INCONCLUSIVE` only after this verification.

For negatives, inspect whether the tool *asserts* a false connection as documented rather than merely listing a qualified exploratory association. Mark `FAIL_NEG` only when the stronger unsupported assertion appears.

## 3. Selected evidence-reviewed findings

### Confirmed positive: Adam–adamah wordplay

- **Case `L001`**, query `H0120`, evidence `r10:wordplay:adam_adamah_gen2_7`, **rank 1**.
- Live `get_connection_evidence_v1` confirms Genesis 2:5–7 and Genesis 3:19; epistemic class `documented_lexical_relationship`.
- **Assessment: PASS for retrieval of explicit biblical wordplay.** The text supports human/ground wordplay.

### Inadequate retrieval: Adam–dam

- **Case `L002`**, query `H0120`, expected `H1818` (blood), top 25.
- A simplistic alias check incorrectly flags `dam` within dotted transliterations such as `a.dam`; the strongest top results do not directly establish `H0120 → H1818` as the expected orthographic candidate.
- **Assessment: NOT a verified PASS.** Exact morphological target checking is required; preserve the original benchmark expectation.

### Confirmed positive lead, incomplete evidence: lamp–light-bearer

- **Case `L027`**, query `G3088`, evidence `r12:path:G3088:G5459` at **rank 5**.
- Tool evidence gives `lamp → illuminate → light-bearer` across Luke 11:36 and Greek lexical roots. A much stronger direct witness exists in **2 Peter 1:19**, which actually contains both `G3088` and `G5459`, but the selected path does not cite it.
- **Assessment: PASS for target discovery, PARTIAL for best-evidence selection.**

### Not found: Hosea 6:2 → Jesus' third-day resurrection

- **Case `S018`**, query `Hosea 6:2`, target `1 Corinthians 15:4` in top 25.
- The top results focus on `H7992` (“third”) and generic clusters; **no convincing third-day resurrection relationship appeared** in the saved top result sample.
- **Assessment: FAIL/UNMET target; interpretive parallel remains a candidate, not a direct quotation.**

### Not found: Unleavened Bread → Red Sea sequence

- **Case `S001`**, query `Exodus 12:15`, expected linkage to Exodus 14 sea crossing.
- Top rankings emphasize unrelated generic clusters and direct matzah grammar, with no strong account of the narrative chronology.
- **Assessment: FAIL/UNMET target as automatic discovery**, although a separately prompted multi-concept query can retrieve pre-existing R10 motifs.

### Query-resolution gap: yeast

- **Case `W025`**, exact benchmark query `yeast` with `mode:"bridge"`.
- Real MCP returns `status:"no_match"`, `missing_concepts:["yeast"]`, 0 ranked records. Independently repeated with same arguments and got the same response.
- **Assessment: CONCEPT_RESOLVER_COVERAGE_GAP, not an HTTP/MCP failure.**

### Four source-verified negative failures still unresolved

These four cases have top-ranked paths that are individually edge-attested but compositionally incoherent. I independently reopened their actual evidence IDs on the recovered MCP. **All four are labeled `documented_lexical_relationship`, tier 3, despite lacking source-scoped endpoint support.**

| Case | Ranked output | Rank | Evidence ID | Why fails |
|---|---|---:|---|---|
| `N001` | Hagar → ostrich | **3** | `r12:path:H1904:H3284` | Hagar's childbirth in Genesis 16, daughters in other contexts, and daughter-of-ostrich expressions are different source statements. |
| `N002` | Eye → angel | **5** | `r12:path:H5869:G0032` | Eye/pity, LXX spare, and the angels of 2 Peter 2:4 are disconnected events. |
| `N003` | Logos → kidney | **4** | `r12:path:G3056:H3629` | Word/speech, testing words, and testing kidneys do not establish a documented lexical endpoint relation. |
| `N004` | Covenant → wheel | **2** | `r12:path:H1285:H0212` | Covenant/ark, moving the ark, and wheels turning in Ezekiel are unrelated clauses. |

**Assessment: four confirmed `FAIL_NEG` controls.** These are ranking/epistemic-composition defects, **not infrastructure defects**. They are unchanged from the 2026-11-18 audit because this deployment intentionally fixed only runtime CPU processing.

## 4. Next development sequence

1. **Treat the HTTP 503 incident as resolved for this 239-case serial run.** Do not spend another agent cycle re-debugging the old CPU error without new evidence.
2. Prioritize the composability and endpoint-convergence repairs in `research/r12/CHATGPT_INDEPENDENT_DISCOVERY_AUDIT_2026-11-18.md`. The `N001–N004` failures remain easy to reproduce.
3. Improve cross-book event/chronology discovery (especially `S001`, `S018`) and concept resolution (`W025`).
4. Perform full evidence-level review of positive top-K candidates before claiming recall/precision metrics; the published snapshot provides all 239 ranked result lists and IDs for that task.
5. Keep old benchmark definitions and failed historical snapshots unchanged so a new algorithm release can be compared against exactly these cases.

**Final distinction:** **Infrastructure PASS** (239/239 valid MCP responses, zero observed 503) does **not** imply **Discovery quality PASS** (four verified negative failures and important misses remain).
