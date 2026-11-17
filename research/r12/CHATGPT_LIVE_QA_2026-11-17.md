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


## Second-pass edge-case suite — added 2026-11-17, ChatGPT read-only MCP

**Coverage:** Multiple real Hebrew and Greek occurrences, repeated homographs, Psalm heading (verse 0), MT/canonical verse boundary, contradictory query inputs, source-vs-relationship word IDs, exact unresolvable evidence, lexical pagination, stale release, reverse LXX, self-target graph path, and live service reliability. No local/production changes; all calls used the connected BibleResearch MCP.

**Notation:** PASS = expected behavior observed; CONFIRMED DEFECT = evidence contradicts required identity or textual status; GAP = behavior may be by design but lacks usable occurrence resolution; UNVERIFIED = test was blocked by intermittent gateway HTTP 503.

### QA-04 CONFIRMED — repeated surface word identity crosswalk mismatch, not only H7307

Independent canonical STEP verse tokens in \`prompt_verse_words({p_book:1,p_chapter:1,p_verse:2,limit:30})\`:

| Verse token | STEP word_id | \`get_unified_word_relationships_v2\` word_id when position supplied |
|---|---:|---:|
| H7307 position 9, וְר֣וּחַ | 130555 | 130527 |
| H6440 position 7, פְּנֵ֣י | 118734 | 118259 |
| H6440 position 13, פְּנֵ֥י | 118736 | 118259 |
| H1961 position 2, הָיְתָ֥ה | 55675 | 55544 (with contradictory query in QA-05) |

The second and third H6440 occurrence resolved to the **same incorrect word_id 118259**. \`get_word_details({word_id:118259})\` returns **בְּפָנֶ֔יךָ**, a different form. \`get_word_details({word_id:130527})\` returns **בְר֙וּחַ֙**, not the Genesis 1:2 surface. \`get_word_details({word_id:55544})\` returns **אֶֽהְיֶ֑ה**, not Genesis 1:2 position 2.

**Diagnosis from observed data only:** the relationship occurrence object has the correct verse and/or position but uses a mismatched \`word_id\`, apparently from a form/identity crosswalk. Whether this is a source-local ID being mislabeled or a broken join must be decided from implementation code. Correct solution should preserve canonical original language source token and STEP form identity in **separate explicitly named fields** where the namespaces differ; no word-specific patches. A repeated lemma in the same verse must not alias distinct exact word-form IDs.

**Acceptance fixture:** position 7 => 118734; position 13 => 118736; position 9 => 130555; position 2 => 55675, or an explicitly documented alternative namespace with a verified STEP mapping and zero false word_id claims. Recheck Hebrew and Greek corpus independently.

### QA-05 CONFIRMED — contradictory explicit query selectors silently override caller intention

Called:

\`\`\`json
{"query":"H7307","word_id":130555,"book":1,"chapter":1,"verse":2,"position":2,
 "layers":["lexical"],"lexical_limit":1}
\`\`\`

Response: \`status="not_covered"\`, \`focus.lemma_id="lemma:H1961"\`, \`resolved_occurrence={reference:"GEN 1:2",position:2,word_id:55544,lemma_id:"lemma:H1961"}\`.

The explicit requested lemma and STEP word_id were **H7307**, but the service quietly switched the focus to **H1961** based on the mismatching passage position. The result did not provide an explicit \`selector_mismatch\` error or field-level reason; \`not_covered\` may mislead clients into interpreting the disagreement as missing data.

**Required behavior:** when multiple supplied selectors refer to inconsistent entities, return a clear mismatch/disambiguation response with each supplied selector and its resolved value; never silently substitute one word for another. A single consistent clicked occurrence should preserve its identity. Re-run after QA-04 repair.

### QA-06 GAP — Greek repeated word has no exact resolved occurrence

\`prompt_verse_words({p_book:43,p_chapter:1,p_verse:1})\` returns three distinct G3056 word forms:

- position 5: \`word_id=15230\`, \`λόγος,\`
- position 8: \`word_id=15229\`, \`λόγος\`
- position 17: \`word_id=15231\`, \`λόγος.\`

For each exact \`get_unified_word_relationships_v2\` request with \`query:"G3056"\`, matching \`word_id\` and \`position\`, \`resolved_occurrence=null\`; lexical relationships still return successfully. Separate \`get_passage_grammatical_frames_v2\` on JHN 1:1 in **Nestle1904 and SBLGNT** returns \`no_evidence_in_covered_scope\`, 3 frames and 0 relations, so missing six-predicate R3 evidence is correctly reported. **However**, this does not by itself explain why an explicit STEP token selection is not represented as an exact resolved occurrence.

Treat this as an **exact-click navigation/crosswalk gap**, not proof of wrong grammar. Require distinction between *token present and resolvable* and *R3 grammatical relationship unavailable*. Never create artificial John 1:1 grammatical edges just to fill the gap.

### QA-07 PASS with occurrence-navigation gap — Psalm heading and versification canaries

- \`prompt_verse_words({p_book:19,p_chapter:3,p_verse:0})\` returned **6 Hebrew heading tokens** (including David at position 2, STEP \`word_id=53063\`).
- \`get_passage_grammatical_frames_v2({book:19,chapter:3,verse:0})\` returned **3 frames and 1 relation**, \`status=ok\`.
- \`get_relationship_coverage_v2({book:19,chapter:3,verse:0})\`: \`reference="PSA 3:0"\`, \`covered=true\`, \`status=ok\`.
- But \`get_unified_word_relationships_v2({query:"H1732",word_id:53063,book:19,chapter:3,verse:0,position:2,layers:["lexical"]})\` returned \`resolved_occurrence=null\`. There is a separate exact-occurrence mapping gap even in a **covered heading**.
- \`prompt_verse_words\` and \`get_passage_grammatical_frames_v2\` both returned tokens/frames for Genesis 31:55 and Genesis 32:1. This is **basic nonzero-verse retrieval only**, not an independent proof that the MT 32:1 ↔ canonical Genesis 31:55 verse shift is mapped correctly. Follow-up source-index equivalence check still needed.

### QA-08 CONFIRMED semantic label mismatch — Hagar name vs sojourner lemma

Previously the natural-language discovery query \`"Hagar seeing spring well eyes Genesis 16 Genesis 21"\` returned a highest-ranked **"hagar" + "seeing"** direct convergence at **Job 19:15**, evidence \`r11:intersect:verse:H1481:H5869:13313\`.

Independent evidence drilldown confirmed source \`lemma:H1481\`, target \`lemma:H5869\`, matching Job 19:15 original words **H1481 "those who sojourn"** and H5869 "eyes". This is a **real separate-word verse co-occurrence**, but the claim that it is about the biblical person Hagar is incorrectly labeled. \`resolve_research_concept_v1({query:"Hagar"})\` correctly resolves \`lemma:H1904\`, which \`expand_biblical_connection_v1({node_id:"lemma:H1904"})\` grounds in Genesis 16/21 passages.

**Issue:** inconsistent entity resolution / query-term labeling between natural-language discovery and canonical resolver, allowing a true Job 19 co-occurrence to masquerade as a Hagar connection. Inspect R11 parsed-query candidate ranking and exact query-support assignment, then require alias/name-to-canonical-key identity agreement. Do not remove the true H1481 Job edge; fix its relevance/labeling. Refuse unverified transliteration or English gloss equivalence.

### QA-09 confirmed prior issue — single H7307 token as two conceptual occurrences

\`get_connection_evidence_v1({evidence_id:"r11:intersect:verse:H7307:H7307:2",release_id:"r11-v1.0"})\` returned one highlighted H7307 token (Genesis 1:2, position 9), while the source/target \`lemma:H7307\` repeat and \`matched_terms=["H7307","H7307"]\`. A **one-token polysemy** was promoted to **Tier 2 direct textual co-occurrence**, with score 1080. This must be separately categorized as lexical ambiguity, not occurrence convergence. Re-run R11 motif ranking after fixing.

### Availability — observed repeated gateway HTTP 503

Multiple calls to \`discover_biblical_connections_v1\` failed in sequence with \`Cloudflare relationship graph gateway HTTP 503\`, including the small \`"Hagar"\` / Hagar spring query and the spirit/wind query. Some \`lookup_lxx_translations_v2\`, lexical page 2 and wrong-position queries also returned 503, but later identical/similar limited calls succeeded. Do not infer that a specific input caused the failure, or that all failures are CPU overages. This is a reproducible **intermittent service availability** concern; inspect request IDs/time window, active Worker logs/CPU/memory and MCP gateway upstream behavior. Avoid uncontrolled high-concurrency probing. Record the exact request/response time and status for the next test.

### Additional PASS controls

- **Ambiguous base H0430:** \`resolve_research_concept_v1({query:"H430"})\` returned \`needs_disambiguation\` with 4 candidates: \`lemma:H0430G\`, \`lemma:H0430H\`, \`lemma:H0430I\`, \`lemma:H0430a\`. Explicit \`H0430G\` resolved as its own lemma. Do not collapse them.
- **Unknown lemma:** \`H999999\` returned \`not_found\`.
- **Lexical pagination:** G3056 \`limit:2,offset:0\` IDs \`G0356,G3049\`; \`offset:2\` IDs \`G3050,G3052\` (no overlap); \`offset:999\` returned empty with \`has_more=false\`.
- **Reverse lexical edge:** querying \`endpoint_key:"root:H7307"\` returned one incoming canonical edge pointing to \`lemma:H7307\` with the same stable source relationship ID as forward traversal.
- **LXX direction and candidate guardrails:** H7307→G4151 has 259 published renderings, H7307→G0417 44 and H7307→G4157 3 (total 306). Reverse G4151→H7307 preserved the same \`rel:lxx:trans:H7307->G4151\` ID and 259 attestations. Source explicitly says \`translation_candidate_only=true\`, \`not_synonymy=true\`, \`not_token_alignment=true\`, \`not_nt_usage_claim=true\`. \`mapping_status="exact"\` means exact **record/lemma mapping** in this release, *not* aligned passage tokens; the UI must not display this as exact verse alignment.
- **Psalm 3:0 heading coverage:** 6 STEP tokens, 3 grammar frames, 1 verified relationship (as above).
- **Invalid relationship release:** \`get_relationship_coverage_v2({release:"r9b-does-not-exist"})\` returned \`release_not_found\` rather than silently loading default.
- **Unknown discovery evidence:** \`get_connection_evidence_v1({evidence_id:"r11:this-is-not-a-real-evidence-id",release_id:"r11-v1.0"})\` returned \`status=not_found\`, \`evidence=null\`.
- **Self-target paths:** \`discover_relationship_paths_v1({source:"lemma:H7307",target:"lemma:H7307",max_hops:2,limits:{max_nodes_expanded:6,max_edges_examined:200,max_paths_returned:5,max_asset_requests:12,max_execution_ms:1200}})\` returned 0 paths and **status=incomplete_coverage**, with explicit \`max_edges_examined\`/120-per-node cap and 1,097 unloaded contextual neighbors, rather than claiming a proven no-connection result. This is correct caution, not an exhaustive search.

### Prioritized Hydrogen fix plan / independent retests

**P0 identity:** Trace STEP \`words.id\`, source MACULA morphology/token IDs, R9B occurrence resolver metadata, \`word_id\` response field and cross-namespace join. Make exact source/STEP IDs unambiguous. Add fixtures Genesis 1:2 positions 2,7,9,13; John 1:1 positions 5,8,17; Psalm 3:0 position 2.

**P0 selection contradictions:** reject or clearly signal inconsistent \`query\`, \`word_id\`, \`position\`; never switch focus silently. Preserve lemma-wide browsing when passage context unspecified.

**P0 false R11 direct claims:** demand independent original-word token identities for occurrence intersections. Reject self-pair with same one token; allow actual repeated-word features only as labeled repetition, never two different senses by default. Normalize R11 "Hagar" to H1904 or ask for disambiguation, never rank H1481 as a Hagar-person hit.

**P1 availability:** inspect intermittent 503 gateway path; test two identical requests spaced apart at low concurrency and correlate request logs before blaming backend limits.

**P1 scope gaps:** return exact selected Hebrew/Greek/Psalm-heading token identity even when six R3 grammatical relations are absent, with \`no_evidence_in_covered_scope\` distinct from \`occurrence_unresolved\`. Preserve correct edition and source witness.

**P2:** optimize giant unified payload without dropping provenance (one small limit request was ~64KB JSON); support lazy hydration, and keep LXX candidate vs actual attested alignment labels clear.

**Scope:** This report is **read-only QA** of deployed existing R9B/R11 MCP, not confirmation of unpublished R12-01 UI preview, staging or GitHub feature branch. Keep actual pass/fail/provenance labels; no speculative server modifications here.
