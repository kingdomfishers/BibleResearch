# ChatGPT R12 live MCP QA — 2026-11-17

**Status:** Read-only production MCP tests. No local checkout, Cloudflare deployment, Supabase row or Worker was modified. This file is an independently reproduced issue list, not the working agent's implementation checkpoint. Original UI preview/browser testing remains **unverified from ChatGPT**.

**References:** Claude Sonnet's local `research/r12/CHATGPT_CHECKPOINT.md`, R12 task queue and `R12_ASTRA_EXECUTION.md`. The user supplied the checkpoint in ChatGPT for comparison.

## Verified live service

Tools connected in ChatGPT included `get_unified_word_relationships_v2`, `get_relationship_coverage_v2`, `prompt_verse_words`, `get_word_details`, `discover_relationship_paths_v1`, `discover_biblical_connections_v1`, `get_connection_evidence_v1`, `resolve_research_concept_v1`. The underlying relationship release was `r9b-v1.0`; R11 discovery returned `r11-v1.0`. These tests do **not** exercise unpublished R12-01 UI code.

### PASS: Basic H7307 direct relationship lookup

Input: `get_unified_word_relationships_v2({query:"H7307",book:1,chapter:1,verse:2,position:9,lexical_limit:10,contextual_limit:3,lxx_limit:8})`.

- `status=ok`, canonical focus `lemma:H7307`, 5 lexical records, 1,097 contextual neighbors, 3 LXX bridge candidates (259, 44, 3).
- Lexical IDs: `lemma:H7308`, `root:H7307`, `sense:H7307H:sub`, `sense:H7307I:sub`, `sense:H7307J:sub`.
- The H7307/H7308 cognate record ID is `rel:v1:lex:cognate:lemma:H7307:lemma:H7308:8e8db817bcd7`.
- `resolved_occurrence` returns `GEN 1:2`, position 9, **word_id 130527**. This is **not the correct STEP word ID for that verse token**; see issue QA-01.

### PASS: Basic G3056 direct relationship lookup

Input: `get_unified_word_relationships_v2({query:"G3056",book:43,chapter:1,verse:1,lexical_limit:12,contextual_limit:3,lxx_limit:8})`.

- `status=ok`, focus `lemma:G3056`, 10 lexical records, 1,009 contextual neighbors, 5 LXX bridge candidates (668, 10, 10, 6, 3).
- Incoming related `G0356`, `G3049`, `G3050`, `G3052`, `G3054`, `G0626`; root `G3056`; senses `G3056:as:1:3`, `G3056:as:2:4`.
- `resolved_occurrence=null`, passage scope `no_evidence_in_covered_scope` in JHN 1:1: correct to refrain from asserting an occurrence-specific R3 clause relation.

### PARTIAL: Existing multihop

`discover_relationship_paths_v1({source:"lemma:H7307",target:"lemma:G4151",max_hops:2,limits:{max_nodes_expanded:15,max_edges_examined:800,max_paths_returned:6,max_asset_requests:30,max_execution_ms:3500},limit:6})`

- `status=ok`, one path returned; **coverage.exhaustive=false**.
- Limits reached: per-node edge cap 120 at both endpoints. Metadata: `nodes_expanded=2`, `edges_examined=532`, `asset_requests=9`, `bytes_read=1,009,377`, `execution_ms=45`.
- This is *not* an exhaustive 2-hop search; do not label no further paths as no connection.

## QA-01 — CONFIRMED wrong occurrence word_id mapping

Two separate live read-only tools disagree for the **same exact occurrence**:

- `prompt_verse_words({p_book:1,p_chapter:1,p_verse:2,limit:25})`: 9th token is `word_id=130555`, Strong `H7307`, surface `וְר֣וּחַ`.
- `get_unified_word_relationships_v2({query:"H7307",book:1,chapter:1,verse:2,position:9,...})`: `resolved_occurrence.word_id=130527`, same verse/position.
- `get_word_details({word_id:130527})`: surface `בְר֙וּחַ֙` (different form).
- `get_word_details({word_id:130555})`: surface `וְר֣וּחַ` (matches Genesis 1:2).
- Even when `word_id:130555` was explicitly supplied to the unified lookup, `resolved_occurrence.word_id` remained `130527`.

**Impact:** an apparently exact clicked occurrence returns a different canonical STEP word-form ID although the lemma H7307 is correct. Investigate the MACULA/STEP join and namespace semantics. If the field is intentionally source-local, rename and namespace it instead of returning it as `word_id`. Never "correct" with a hardcoded H7307 exception.

**Regression:** Genesis 1:2 position 9 yields canonical STEP word ID 130555; no other mismatched-surface word_id; Hebrew+Greek occurrence-identity fixture; never infer exact occurrence based solely on lemma/verse if multiple matching tokens.

## QA-02 — CONFIRMED false self-pair textual convergence

`discover_biblical_connections_v1({query:"spirit wind seven lamps seven eyes",limit:5,max_hops:2})` returned `r11:intersect:verse:H7307:H7307:2` with title **"Direct textual convergence: spirit + wind in Genesis 1:2."**

Evidence drilldown via `get_connection_evidence_v1({evidence_id:"r11:intersect:verse:H7307:H7307:2",release_id:"r11-v1.0"})`:
- `source_node_id=lemma:H7307`; `target_node_id=lemma:H7307`.
- `matched_terms=["H7307","H7307"]`, `derivation_method="exact_verse_lemma_intersection"`.
- `original_tokens` shows only one H7307 token at word_no 9 in Genesis 1:2.
- `epistemic_class="direct_textual_evidence"`, score 1080: too-strong certainty for a self-lemma intersection.

**Impact:** polysemous glosses of the same source lemma are counted as two distinct verse co-occurring concepts. This produces a **false direct textual co-occurrence**. A lexical entry can have different possible senses; that is not two tokens or proof of both senses in the passage.

**Regression:** same-lemma/same-occurrence pair must not create co-occurrence claims; two independently attested original token IDs can count, when both actually occur. Keep lexical polysemy in LINGUISTIC/HYPOTHESIS, not double occurrence.

## QA-03 — NEEDS INVESTIGATION: Hagar natural-language mapping inconsistency

`discover_biblical_connections_v1({query:"Hagar seeing spring well eyes Genesis 16 Genesis 21",limit:5})` returned as strongest a supposed `"hagar" + "seeing"` textual convergence in **Job 19:15**, whose source node identifier was `H1481` in the evidence key `r11:intersect:verse:H1481:H5869:13313`. This is suspicious because Hagar the named person is `H1904` and not present in Job 19:15.

Independent `resolve_research_concept_v1({query:"Hagar"})` **correctly** returned `lemma:H1904`, `הָגָר`, gloss Hagar. Therefore the natural-language discovery parser / candidate selection may be diverging from the standalone resolver, or mixing transliteration with glosses. Inspect `parsed_query` and direct evidence to determine the exact bug; do not assert root cause until verified.

**Regression:** query "Hagar seeing spring well" must choose proper name H1904 or request disambiguation, never label H1481 as Hagar. Keep the useful eye/spring H5869 polysemy evidence separately.

## Availability and scope

- An occasional relationship/discovery tool request returned **HTTP 503** during the investigation; retry later with a bounded request and record source/latency before attributing cause.
- The uploaded Claude checkpoint's Cloudflare **application preview URL** was not accessible through ChatGPT's web fetch. The ChatGPT Browser tab connector also returned `Browser access requires the originating browser context`. **No end-to-end preview DOM, login/CORS, Playwright, or mobile UI test can be claimed here.**
- To let ChatGPT test new implementation code, deploy the *actual updated corpus gateway and MCP adapter* to a safe test route, refresh/connect the corresponding BibleResearch MCP tools (or provide a version-qualified read-only endpoint). A new UI preview alone does NOT update the MCP connection.
- User can independently open the preview in a browser and share browser console/network evidence or use ChatGPT Work mode for browser navigation. Never claim remote browser verification from these MCP tests.

## Next handoff

1. **Hydrogen publishing-only first pass**: preserve dirty local work; read local checkpoint, create explicit-path R12-01 commit/push, test/publish read-only safe staging/preview and provide exact URLs, release/commit, MCP tool registration/status. Do not run an expensive redesign before ChatGPT tests the new deployed version.
2. **Hydrogen fix pass after this QA report**: prioritize QA-01 occurrence identity and QA-02 same-lemma self-pair; investigate QA-03 Hagar resolver mismatch; diagnose preview DOM/browser error; strengthen stale-response test and LXX candidate navigation in local R12-01 queue. Fix at source rule level, not with manual word-specific exceptions.
3. After new version is deployed, **rerun these exact connected MCP tests** from ChatGPT and compare release hashes, evidence IDs and edge/passage statuses. R12-02 heavy multihop work can then proceed.
