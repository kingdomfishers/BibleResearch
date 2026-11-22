# MCP v2 reliability fixes — 2026-11-22

## Release

Worktree: `C:/Projects/BibleResearch-r10`, branch `feat/r12-qa-fixes`.
The originally attached checkout was an older R8 branch without the audited seven-tool implementation. Its unrelated work was preserved. Existing overlapping draft fixes in the R12 worktree were inspected, corrected and retained; unrelated browser scripts, CLI snapshots and research proposals were excluded from the commit.

Runtime code commit: `de68f0124fd91a5e3dc5cb48fd4b44b545ba2544` (`fix(mcp): verify token identity and harden seven-tool research`).

- Main corpus Worker: `93de1432-6121-4204-bf69-d6a3c547192e`.
- Main Supabase `bible-mcp`: deployment v50 (`ezbr_sha256: 9f84721a76c73ebf739479da9a31dbe4702b199b7864860f3e34564df2df6ea4`), retaining `verify_jwt:false`, existing notes permissions and the seven-function surface. The workflow contract version remains `2.0.0`.
- Static assets, source datasets, discovery release `r12-discovery-2`, scores and discovery algorithm were not changed. Wrangler reported no updated static assets. Existing `R12_SOURCE_COMMIT=d994005...` describes the static evidence release, not this runtime patch.
- Rollback baseline: corpus `e96253fd-4144-4869-a54b-72d5931c6ab6`, MCP v46 (`fdda29cf5f7623372a9ca1e3f4c9f2b9655d7f358c97b6ff3ea10f9d9e7d4f0e`). No database migration or corpus repair is required to roll back runtime code.

## Root causes and corrections

### Source identity

The compact corpus handler joined MACULA `word_no` to STEP canonical positions. These independently numbered streams can have gaps and different segmentation. Supabase returned correct lexical rows for the incorrectly joined word IDs. The words table was not the cause.

The canonical STEP chapter-lite sequence now owns surface, position, word-form ID and morpheme links. Cross-source lexical context is attached only through an unambiguous monotonic surface/Strong's alignment. Identical streams use a linear fast path; differing streams retain only pairs forced by all optimal sequence alignments. Repeated words surrounding an omitted token therefore cannot steal another occurrence's gloss. Missing canonical spines expose source tokens without invented canonical IDs.

Runtime enrichment independently verifies word-form ID, normalized surface with vowels retained, primary Strong's and available extended-lemma identity. Unknown enrichment is omitted/marked partial. `word_id` identifies a word form; canonical `verse_id + pos` (or research `position`) identifies an occurrence. Multiple source homograph links remain candidates; neither array order nor verse-specific rules select a sense.

| Zechariah 4:2 token | Archived wrong association | Correct canonical result |
| --- | --- | --- |
| מְנוֹרַת֩ | pos 10, word 59034, `za.Hav` | pos 9, word 91302, `me.no.Rat`, `HNcfsc`, H4501 |
| זָהָ֨ב | word 79865, `ku.Lah` | pos 10, word 59034, `za.Hav`, `HNcmsa`, H2091 |
| נֵרֹתֶ֙יהָ֙ | word 110317, `'a.Lei.ha` | pos 16, word 99243, `ne.ro.Tei.ha`, `HNcfpc/Sp3fs`, H5216 |

`get_Passage`, `research(passage_compare)` and passage inputs to `get_Connection` share the corrected compact source. Word-in-passage lookups validate their enrichment too. The underlying source assets and database rows remain intact. The legacy relationship path already uses its own canonical crosswalk; this patch does not replace it with MACULA ordinals.

An offline corpus inventory examined all **31,203 verses / 443,524 canonical tokens**: 674 verses have different source token counts; 5,726 have positional surface disagreements (19,963 tokens, including 2,028 missing source-local positions). These are diagnostics, **not a count of proven corrupt verses**: edition spelling, punctuation and segmentation also differ. There were no missing canonical chapter-lite verses. The conservative alignment omitted uncertain cross-source context for 21,835 tokens; canonical forms/IDs remain available. The inventory did not rerun discovery benchmarks or scan the whole corpus in a browser.

### Lexical evidence

- Etymology roots and relatives are scoped to their documented extended lemma. H3724D's village-related root is no longer attributed to the selected H3724A entry or to a pitch occurrence. Other homographs are labelled separately. No H3722/H3724 root relationship was invented.
- Selected lemmas, alternative senses and Strong's-group sample forms are distinct. An anchored word keeps its own lemma, transliteration and grammar; a lexeme lookup no longer borrows an arbitrary inflected form as its own morphology.
- Cluster counts use actual `vids` when a precomputed `count` is missing/zero.
- LXX targets are deduplicated by normalized identity, with translation direction explicit. Duplicate source counts are not added together; the largest reported count is retained.
- Documented roots, morpheme candidates, spelling suggestions, arithmetic and wordplay hypotheses remain distinct. Ambiguous component assignments are not promoted to facts.
- Gematria retains the actual specified spelling and named method: רוח = 214, כפר = 300 under standard Hebrew calculation. Anchored calculation uses the selected lemma spelling, not a conflicting profile.

### Output and cross-tool consistency

Passage lexicons describe lemmas, while occurrence rows carry forms/transliteration/grammar. Repeated lemma fields inherit from the shared lexicon only when identical. Connection presentation is compacted **after** the existing selection; no extra candidate filtering or score changes were introduced. All requested verses remain complete.

Research comparisons hoist repeated lexical fields, retain complete text and IDs, and omit nested raw xref/profile context. Their `key` is a dictionary reference; its lexicon entry's `lemma_key` is the source identity. Verified grammar/transliteration match the passage tool. Full comparisons page the compact RPC at its real 50-verse limit (including a 176-verse Psalm regression).

Word inputs to `get_Connection` now include the same grammar forms and occurrences as `get_Word`; nested word-connection counts respect the requested limit. The database adapter no longer silently stops after 400 word forms: it processes all requested IDs in batches of 100 with at most four concurrent requests.

### Chains and research reliability

Returned chain candidates are persisted. A selected known edge retains `edge_id`, relationship, epistemic class and supporting references, even when selected by ordinary target passage. Unmatched jumps remain exploratory. Traversed edges are excluded immediately. Bound sessions reject both missing and wrong session IDs; clients without session binding retain opaque capability access. Handles are hashed at rest and expire without being renewed by updates.

Request headers and corpus routing are captured per HTTP request rather than shared mutable application state. Independent research operations retain successful results when another operation fails; sanitized errors explain which operation failed. Persistent source errors no longer become empty successful database matches. Incomplete comparison sources/graph results explicitly report partial status.

Chronology counts matching canonical verses by model, axis and date distribution, separating uncertain intervals from exact date bins. It examines up to 1,000 indexed verses independently of the displayed witness limit, and reports examined/dated/undated coverage and possible assertion truncation. These are model-based verse distributions, not historical word frequencies or independent event counts.

Geography returns readable references and preserves source relationship roles (including audience/composition/event/mention distinctions where actually supplied). Unknown roles remain unknown. It does not infer that Corinth was the location where an epistle was written.

`get_prompt` now returns accurate concise guidelines for the seven tools, connection-depth controls, etymology/realworld settings, evidence verification and authorized notes. Canonical skill/contract and generated workflow remain synchronized.

## CPU budget and remaining limitations

Production tail logs confirmed `outcome: exceededCpu`, `cpuTime:10`, HTTP 503 on the free corpus Worker. This is an observed runtime ceiling, not an inferred database fault. No paid plan, security weakening or ranking change was used to mask it.

Passage profile hydration now uses the same corpus-generated candidate plan across four-profile internal batches. Local parity checks for Zechariah 4 and Corinthians prove identical data, candidate membership and ordering. This reduces work per request. Worker minification reduced upload size from approximately 627 KiB to 361 KiB; it does **not** establish that CPU exhaustion is impossible. Graph discovery still has its existing runtime budget. Clients must inspect partial/error status and retry unavailable evidence rather than infer nonexistence.

Additional limits:

- Source homograph ambiguity, unavailable roots and unresolved cross-edition mappings remain explicit; the patch does not manufacture missing scholarly relationships.
- Morphology forms and aggregate LXX/occurrence statistics are scoped to the Strong's group when finer source disambiguation is unavailable.
- LXX counts from different evidence sources are not a reconciled count of independent alignments.
- Chronology is bounded at 1,000 matching verses and 400 assertions per adapter batch; possible truncation is disclosed.
- Geography searches cover published links, not a complete role-labelled gazetteer. Unknown geography roles are not inferred.
- Chain handles are capabilities for clients without a session ID. Multi-step evidence does not prove a direct endpoint relationship. Existing migration/RLS was preserved; expiry was tested with a controlled clock locally rather than waiting 24 hours live.
- Payloads are not universally smaller: trustworthy additional senses, homograph alternatives and attribution can increase small lexical/passage responses. Complete requested text is retained.

## Verification

Focused offline commands (from repository root):

```powershell
node scripts/verify-mcp-token-alignment.mjs
node --import ./scripts/mcp-deno-loader.mjs scripts/verify-mcp-word-model.mjs
node --import ./scripts/mcp-deno-loader.mjs scripts/verify-mcp-research-reliability.mjs
node --import ./scripts/mcp-deno-loader.mjs scripts/verify-mcp-chain-prompt.mjs
node --import ./scripts/mcp-deno-loader.mjs scripts/verify-mcp-transport-reliability.mjs
node --import ./scripts/mcp-deno-loader.mjs scripts/verify-mcp-v2-local.mjs
node --import ./scripts/mcp-deno-loader.mjs scripts/verify-bible-mcp-local.mjs
node scripts/verify-research-workflow.mjs
npm.cmd run check:types
npm.cmd run build
```

These passed, including 101 captured canonical word forms across Hebrew, Greek, complex morphology, Ps 45:0, Hos 14:5 and Ezekiel 1/10, plus repeated-token omission and vowel-distinct-form counterexamples. The MCP dependency tree also passed a separate strict TypeScript check using the installed Deno npm cache (frontend typechecking alone does not cover the Edge Function). Build retained the pre-existing large-chunk advisory. A Worker packaging dry run passed.

Local write-key/credential tests use rejecting stubs; the live note probe submits an invalid schema only. **No actual user note was created, updated or deleted.** Private chain handles and note bodies are not included in this handoff.

The bounded live verifier is `node scripts/verify-mcp-v2-audit.mjs --live`. It replays the 12 archived cases, checks metadata parity, all 26 Corinthians verses, Hebrew heading/shifted references, full word comparisons, three concurrent combined requests, persisted evidenced chains with branch/revisit/tamper refusal, invalid-note refusal, B7 and restricted metadata protection. Final results and response sizes are recorded below. The 239-case discovery benchmark was not rerun.

## Independent ChatGPT retest inputs

Refresh the connector before testing; compare original-language evidence rather than connection ranking.

```json
{"tool":"get_prompt","arguments":{}}
{"tool":"get_Passage","arguments":{"passage":"Zechariah 4:2","depth":0,"word_depth":0,"etymology":0,"realworld":0}}
{"tool":"research","arguments":{"operations":[{"op":"passage_compare","id":"comparison","passages":["Zechariah 4:2","Revelation 11:4"],"limit":2}]}}
{"tool":"get_Passage","arguments":{"passage":"Genesis 6:14","depth":1,"word_depth":2,"etymology":2,"realworld":1}}
{"tool":"get_Word","arguments":{"word":"H3724","connections":0,"etymology":2,"realworld":0}}
{"tool":"get_Word","arguments":{"word":"Ruach","connections":10,"etymology":3,"realworld":0}}
{"tool":"get_Passage","arguments":{"passage":"1COR12:10-1COR13:4","depth":10,"word_depth":0,"etymology":0,"realworld":0}}
{"tool":"get_Passage","arguments":{"passage":"Ps 45:0","depth":0}}
{"tool":"get_Passage","arguments":{"passage":"Hosea 14:5","depth":0}}
{"tool":"get_Connection","arguments":{"items":["H3722","H3724"],"connections":3}}
{"tool":"get_Connection","arguments":{"items":["Ezekiel 1","Ezekiel 10"],"connections":10}}
{"tool":"research","arguments":{"operations":[{"op":"gematria","id":"g","terms":["רוּחַ","כֹּפֶר"]},{"op":"geography_search","id":"p","place":"Corinth","limit":2},{"op":"chronology_occurrences","id":"t","word":"H7307","limit":3}]}}
{"tool":"follow_connectionchain","arguments":{"next":"Zechariah 4","limit":3}}
```

Keep the returned chain handle private. Then call `follow_connectionchain` with that handle, `next:"Revelation 11:4",action:"follow",limit:3`; inspect `added_step.edge_id`, relation and refs. Test `inspect`, `branch` from Zechariah 4 and `revisit` to Revelation 11:4. Do not save a note during the independent retest. Inspect partial statuses explicitly, especially on cold/loaded corpus requests.

## Final live results and response sizes

The complete final sweep passed on 2026-11-22T07:30:46.294Z. All 12 archived cases returned their intended successful results; the additional source-identity, full-text, concurrent research, chain/session, invalid-note and protection checks passed. B7 returned `PASS_CANARIES`; restricted metadata remained HTTP 403. Health retained 7 tools, 1 prompt and the legacy endpoint. Earlier sweeps exposed CPU-limit failures and a verifier assumption that validation errors were JSON; both failed attempts are distinguished from this final successful sweep. The verifier now accepts the SDK's plain validation-error text correctly.

Sizes below are UTF-8 bytes of compact serialized structured JSON, compared with the archived `RAW_CASES.json` output, not pretty-printed text or an inflated MCP wire envelope. MCP may include both text and structured content. No empty/partial response is counted as a size improvement.

| Case | Before bytes | Final bytes | Change |
| --- | ---: | ---: | ---: |
| P01 | 9321 | 11888 | 27.5% |
| P02 | 16171 | 24871 | 53.8% |
| P03 | 75366 | 71252 | -5.5% |
| P04 | 159778 | 131744 | -17.5% |
| P05 | 9719 | 14791 | 52.2% |
| W01 | 15175 | 15310 | 0.9% |
| W02 | 5340 | 5205 | -2.5% |
| C01 | 6888 | 6921 | 0.5% |
| C02 | 9576 | 9639 | 0.7% |
| R01 | n/a | 10618 | n/a (archived error) |
| R02 | 12240 | 11670 | -4.7% |
| G01 | 10497 | 4678 | -55.4% |

P04 retains all 26 complete requested verses while reducing repetition. G01 is 55.4% smaller. R02 now includes verified transliteration and grammar that were absent or incorrect before, so its live size reduction is smaller than the offline presentation-only fixture (19%). R01 now returns model/axis distributions and scoped geography instead of just early witness samples; the archived record was an error and is not a valid size baseline. Small passage outputs grow chiefly from explicit lexical senses, separate homograph evidence and safe identity information. These increases are intentional correctness costs, not hidden size improvements.

The final private chain test preserved a known Zechariah/Revelation edge with references across independent HTTP calls, and branch/revisit/tampered-handle checks passed. No handles are published. A later independent cold-load test is still recommended because a passing bounded sweep does not prove the free CPU ceiling can never be reached.
