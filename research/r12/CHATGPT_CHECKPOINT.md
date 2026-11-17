# R12 QA Fixes, Staging Release & Continuation Checkpoint

Written: 2026-11-17  
Authoritative workspace: `C:\Projects\BibleResearch-r10`  
GitHub branch: `feat/r12-qa-fixes` (`origin/feat/r12-qa-fixes`, initial QA fix commit `bb125a4ad2b82c9d93350f4072e026884e672053`, followed by the `chapter-lite` + `by-lemma` compaction commit on top)  
Synchronized queues: `TASKS.md` and `R12TASKS.md` (verified SHA-256 `166847cda457f17b2d8dcba2480af3a54afb3a9217e5b973344fcb311105309a`)

---

## 1. Production Safety Verification (Unchanged)

Production infrastructure was **NOT modified**:
- `bibleresearch` (production web): active Version ID `60eefd79-a256-4ed8-b117-8fc89922a326` (unchanged)
- `bibleresearch-corpus` (production corpus): active Version ID `69d85126-59cd-4711-ba39-23589f59af01` (unchanged)
- `bible-mcp` (production Supabase Edge Function): active `version: 40`, `verify_jwt: false` (unchanged)
- Existing R3/R8/R9B/R10/R11 static releases (`r3-v1.2`, `r8-v1.0`, `r8-v1.1`, `r9b-v1.0`, `r10-v1.0`, `r11-v1.0`) remain intact inside `.artifacts-r12/staging-bundle`.

---

## 2. Deployed Staging Environment & Current Live Status

Isolated staging services deployed (with an important caveat — see §4 on **Cloudflare Error 1102 / HTTP 503**):

| Service | Target URL | Version / State | Notes |
|---|---|---|---|
| Staging Corpus Worker | `https://bibleresearch-corpus-staging.kingdomfishers-custom.workers.dev` | Version ID `e1bc3d5f-687f-464f-a4a7-806cfc1ecb46` (`19,979 / 20,000` files, rebuilt bundle) | **Live & verified:** 15/15 sequential Corpus RPC probes + 8/8 direct QA checks returned HTTP 200 (0 HTTP 503s). Concurrent browser requests on cold isolates can still intermittently hit Error 1102 under Free-tier 10ms CPU when `by-lemma` (1.9 MiB) + `uncovered-lemmas` (797 KiB) load together. |
| Staging Web UI | `https://bibleresearch-staging.kingdomfishers-custom.workers.dev` | Version ID `dedf634a-ce72-4a71-9442-79b647b18dc3` | Built with `VITE_CORPUS_BASE_URL=https://bibleresearch-corpus-staging.kingdomfishers-custom.workers.dev`. Renders `H7307` (`Lex (5) · Ctx (1,097) · LXX (3)`), though concurrent initial page RPCs can still trigger intermittent Error 1102/CORS on cold isolates. |
| Staging Supabase MCP | `https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp-staging/mcp` (`/health`) | `version: 1`, `ACTIVE`, `verify_jwt: false`, `corpus_target: "staging"`, 46 tools, 22 prompts | **Live & verified:** All QA-01..QA-12 checks passed end-to-end through `bible-mcp-staging` against `bibleresearch-corpus-staging` with 0 HTTP 503s. |

---

## 3. QA-01 through QA-12 Fixes & Verification Results

All QA defects from `research/r12/CHATGPT_LIVE_QA_2026-11-17.md` were root-caused, fixed, and verified:

| QA ID | Defect & Root Cause | Fix Implemented | Observed Verification |
|---|---|---|---|
| **QA-01, QA-04, QA-10** (P0) | `stage-r8-relationship-graph.mjs` stamped lemma-level `primary_word_id` (`wids[0]`, smallest `word_id` across the Bible) onto every R8 occurrence, and `r8-v1.1` parsed `slice(8,11)` yielding positions `100/200/201`. | Built versioned `r8-v1.2` (`scripts/build-r12-staging-assets.mjs`, ported to `scripts/stage-r8-relationship-graph.mjs`) mapping exact MACULA/canonical coordinates to STEP `word_id`, 1-based canonical `word_position`, `surface_form`, distinct `source_token_id`, and `word_id_status`, plus 64-bucket `word-id-index`. | **Local `staging-bundle` + Live `bible-mcp-staging` PASS:** GEN 1:2 pos 2 `H1961=55675` (`הָיְתָ֥ה`), pos 7 `H6440=118734` (`פְּנֵ֣י`), pos 9 `H7307=130555` (`וְר֣וּחַ`), pos 13 `H6440=118736` (`פְּנֵ֥י`); no `200/201` positions in `passage_frames`. |
| **QA-06, QA-07** (P0) | `resolveLemmaV2` only scanned R8 `pEntry.relations`, failing when a passage had 0 R8 relations (John 1:1) or predicate-only frames (Psalm 3:0). | `resolveLemmaV2` (`scripts/corpus-relationships-rpc.mjs`) resolves canonical passage tokens (from `chapter-lite` / `/v1/chapters`) alongside R8 frames & relations, returning verified occurrence identity while preserving `no_evidence_in_covered_scope`. | **Local + Live `bible-mcp-staging` PASS:** `JHN 1:1` `G3056` pos 5=`15230` (`λόγος,`), pos 8=`15229` (`λόγος`), pos 17=`15231` (`λόγος.`); `PSA 3:0` pos 2 `H1732=53063`. |
| **QA-05** (P0) | `resolveLemmaV2` short-circuited on first selector and silently switched lemmas (e.g. `H7307` -> `H1961`). | Added cross-selector consistency validation (`query`, `lemma_id`, `extended_strongs`, `word_id`, `token_id`, `position`, `edition_key`). Mismatches return `status: "selector_mismatch"` with `mismatch.conflicting_fields` and zero silent substitution. | **Local + Live `bible-mcp-staging` PASS:** `query="H7307", word_id=130555, GEN 1:2 pos=2` returns `status: "selector_mismatch"`, `conflicting_fields: ["word_id", "position"]`, citing actual `word_id=55675` (`lemma:H1961`). |
| **QA-02, QA-09** (P0) | `discoverBiblicalConnections` treated two senses of one `H7307` token (`spirit` + `wind`) as `r11:intersect:verse:H7307:H7307:2` (`direct_textual_evidence`). | Updated `src/relationships/r10-discovery.ts` (`discoverBiblicalConnections`, `getConnectionEvidence`): when `pA.bs === pB.bs`, emit `r11:repeat:verse:*` only with `>= 2` distinct `wn` positions; otherwise emit `r11:polysemy:*` exploratory notice (`evidence_tier: 5`). Avoided dropping distinct-lemma prefix+noun co-occurrences (e.g. `H4728 + H4480`). | **Local + Live `bible-mcp-staging` PASS:** `spirit wind` does NOT emit `r11:intersect:verse:H7307:H7307:2`; `verify-r11-benchmark.mjs` PASS; `verify-r11-discovery.mjs` `14/14` PASS. |
| **QA-03, QA-08** (P0) | `r10-discovery.ts` skipped `is_prop` matches when any `non_prop` gloss matched `"hagar"`, elevating `H1481` ("to sojourn") in Job 19:15 as Hagar. | Preserved exact-gloss proper-noun matches (`H1904` "Hagar") in `src/relationships/r10-discovery.ts` while retaining legitimate `H1481`/`H5869` evidence unmislabeled. | **Local + Live `bible-mcp-staging` PASS:** `Hagar seeing eyes spring` returns `r11:intersect:verse:H1904:H5869:386` (Gen 16:4), `H1904` grammar (`Gen 16/21/25`), zero `H1481` Hagar mislabels. |
| **QA-11** (P1) | `sample_passages` stored only the first 5 co-occurring verses regardless of `in_same_clause` or `is_collocation`. | Built `r9b-v1.1/contextual` (`same_clause_samples` for 252,358 pairs, `collocation_samples` for 189,216 pairs) and prioritized matching samples (or explicit `witness_status: "matching_witness_not_returned"`) in `scripts/corpus-relationships-rpc.mjs`. | **Local + Live `bible-mcp-staging` PASS:** `H7307` `same_clause` (`25/25` items carry `in_same_clause: true` witness) and `collocation` (`25/25` items carry `is_collocation: true` witness). |
| **QA-12** (P1) | Raw Swete LXX concatenated Roman chapter headings at chapter boundaries (`XXXIIεἰς` in Gen 32:1 #1). | Cleaned 41 chapter-boundary prefixed/suffixed tokens and flagged 61 standalone Roman markers in `v1/lxx/b*.json.gz`, ported to `scripts/import-lxx-swete.mjs` and filtered `!w.is_chapter_heading_marker` in `scripts/corpus-worker.mjs`. Kept `Mωσῆ` / `Xανανείς` untouched. | **Local + Live `bible-mcp-staging` PASS:** `get_septuagint_passage(1, 32, 1)` returns `tokens[0].word_text = "εἰς"`, `normalized_word = "εις"`, `raw_source_word_text = "XXXIIεἰς"`, `chapter_heading_marker = "XXXII"`. |

---

## 4. P1 HTTP 503 Investigation — Root Cause Found & Partial Optimization

1. **Confirmed root cause:** Direct `POST` probes to `https://bibleresearch-corpus-staging.kingdomfishers-custom.workers.dev/v1/rpc/query_relationships_v2` returned **HTTP 503 (`Content-Length: 4805`, HTML error page without CORS headers)** reading:
   `Error 1102: Worker exceeded resource limits`.
2. **Telemetry from local `workerd` (`X-R12-Trace: 1`):**
   - Before optimization, cold requests decoded & parsed huge JSON assets per request:
     - `get_reader_passages_v1` (Gen 1): `4.48 MiB` (`1.15 MiB` unused `metadata.json.gz` + `3.33 MiB` `b1-c1.json.gz`)
     - `unified_lemma` `H7307` (Gen 1:2): `7.70–8.07 MiB` (`3.33 MiB` `b1-c1` + `2.30 MiB` `by-lemma/shard-1a` + `0.80 MiB` `uncovered-lemmas` + ...)
     - `unified_lemma` `G3056` (John 1:1): `10.88–11.41 MiB` (`7.61 MiB` `b43-c1` + `1.73 MiB` `by-lemma/shard-10` + `1.09 MiB` `passages/b43-c1`)
   - On Cloudflare Workers Free Plan (**10 ms CPU limit per request**), cold decompression + `JSON.parse()` of 4.5–11.4 MiB exceeds 10 ms CPU and triggers Error 1102 (no CORS headers), explaining both ChatGPT's intermittent 503s (cold vs warm isolate) and Playwright's CORS failures.
3. **Optimization deployed to `bibleresearch-corpus-staging` (`e1bc3d5f-687f-464f-a4a7-806cfc1ecb46`):**
   - Added 64-bucket `r8-v1.2/chapter-lite/shard-XX.json.gz` (compact WEB text + token coordinates), removed unused `ensureCatalog(env)` from `handleGetReaderPassagesV1`, avoided loading `uncovered-lemmas.json.gz` for secondary prefix morphemes, and compacted `r8-v1.2/by-lemma` summary duplicates (`scripts/build-r12-staging-assets.mjs`, `scripts/corpus-worker.mjs`, `scripts/corpus-relationships-rpc.mjs`).
   - `.artifacts-r12/staging-bundle`: `19,979 / 20,000 files` (`980.3 MiB`).
   - Measured in local `workerd`: `get_reader_passages_v1` `4.48 MiB -> 0.80 MiB`, `H7307` `8.07 MiB -> 4.14 MiB`, `G3056` `11.41 MiB -> 4.38 MiB`.
   - **Live verification after deploy (`e1bc3d5f`):**
     - `bibleresearch-corpus-staging`: 8/8 direct QA RPCs + 15/15 sequential sweep returned HTTP 200 (0 HTTP 503s).
     - `bible-mcp-staging`: All end-to-end MCP QA-01..QA-12 checks passed (`0` HTTP 503s).
     - Local regressions re-run & passing: `verify-r12-qa-fixes.mjs` `11/11`, `verify-r8d-regressions.mjs` `29/29`, `verify-r9c-multihop.mjs` `19/19`, `verify-r12-direct.mjs --only follow-related-word-and-evidence` `1/1`.
     - **Remaining limitation:** Concurrent cold browser requests on `bibleresearch-staging` (`#1-1-2`) can still hit intermittent Error 1102 when `by-lemma` (`1.90 MiB`) + `chapter-lite` (`0.84 MiB`) + `uncovered-lemmas` (`0.80 MiB`, still triggered via `word_id` prefix resolution for secondary morphemes like `H9002`) run in parallel on a cold Free-tier isolate (`Summary: Relationships · Gram (0) · Lex (5) · Ctx (1,097) · LXX (3)`).

---

## 5. Next Follow-up Optimizations (for Next Session)

1. Skip `loadUncovered()` (`797 KiB`) for secondary morphemes in the `word_id` selector branch of `resolveLemmaV2`, and further trim `r8-v1.2/by-lemma` (remove `sample_relations` copy from `by-lemma` summaries since `evidence/by-summary` serves the drawer) so cold isolate decoded bytes drop below ~1.2 MiB for concurrent browser traffic.
2. Re-run full `check:types`, `build`, `verify-r12-direct.mjs` (both local and live `R12_TEST_URL`), and deploy the slimmer bundle to `bibleresearch-corpus-staging`.

---

## 6. Copyable Prompt for ChatGPT Independent Verification (Staging MCP)

Connect ChatGPT to the staging MCP URL (`https://ejoperxiwxlcbsqrkrvb.supabase.co/functions/v1/bible-mcp-staging/mcp`) once the continuation agent finishes redeploying `bibleresearch-corpus-staging`:

```text
Verify the BibleResearch staging MCP server tools and report exact returned JSON fields, word IDs, surface forms, and statuses (do not guess or fill from memory):

1. GEN 1:2 occurrence identity (get_unified_word_relationships_v2):
   - query="H1961", book=1, chapter=1, verse=2, position=2 (expect word_id=55675, not 55544)
   - query="H6440", book=1, chapter=1, verse=2, position=7 (expect word_id=118734, not 118259)
   - query="H7307", book=1, chapter=1, verse=2, position=9 (expect word_id=130555, not 130527)
   - query="H6440", book=1, chapter=1, verse=2, position=13 (expect word_id=118736, not 118259)

2. John 1:1 & Psalm 3:0 occurrence identity (get_unified_word_relationships_v2):
   - query="G3056", book=43, chapter=1, verse=1 at positions 5, 8, and 17 (expect 15230, 15229, 15231 and explicit no_evidence_in_covered_scope on grammar)
   - query="H1732", book=19, chapter=3, verse=0, position=2 (expect word_id=53063)

3. Contradictory selector rejection:
   - query="H7307", word_id=130555, book=1, chapter=1, verse=2, position=2 (expect status="selector_mismatch" with conflicting_fields=["word_id","position"], never switching to H1961)

4. Discovery accuracy (discover_biblical_connections_v2):
   - query="spirit wind" (confirm NO r11:intersect:verse:H7307:H7307:2 direct_textual_evidence claim)
   - query="Hagar seeing eyes spring" (confirm H1904 Hagar resolves cleanly and H1481 Job 19:15 is never labeled Hagar)

5. Contextual witnesses & Swete LXX:
   - page_contextual_neighbors_v2 query="H7307", contextual_scope="same_clause" and "collocation" (confirm every returned item includes a matching witness with in_same_clause=true / is_collocation=true)
   - get_septuagint_passage p_book_no=1, p_chapter=32, p_verse_nr=1 (confirm tokens[0].word_text="εἰς" and raw_source_word_text="XXXIIεἰς")
   - Check p_book_no=1 for 30:1, 31:1, 33:1 and p_book_no=2 (Exodus) 32:1, plus H0430 disambiguation and Psalm 3:0->LXX 3:1 controls.
```
