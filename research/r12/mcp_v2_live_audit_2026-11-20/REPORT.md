# BibleResearch MCP v2 — Independent live tool audit

**Date:** 2026-11-20  
**Environment:** Connected ChatGPT BibleResearch MCP, reported research workflow `v2.0.0`. GitHub inspected on `feat/r12-qa-fixes` (source file `supabase/functions/bible-mcp/discovery-v2-tools.ts`).  
**Evidence:** [RAW_CASES.json](RAW_CASES.json) contains exact submitted JSON arguments and full returned structured JSON for **12 read-only test cases**, plus sanitized start/follow chain responses. Private chain handles are redacted; user-authored note data is never published. No note writes were attempted.

## Executive verdict

**Functional proof of concept, but NOT YET a trustworthy deep original-language research base.** The seven-function surface exists and the common requests work. However, a **confirmed word/metadata alignment defect** in Zechariah 4:2 can silently attach another token's transliteration, grammatical code and lemma key to a word. Important passage-level discoveries are also outranked by generic lexical/grammatical associations, and output is too verbose on long passages.

**Priority:** P0 source-identity repair and regression tests; P1 high-interest connection selection; P2 response compression/coverage/chain and advanced analysis usability. Do not tune scores or assert DLM findings from suspect token metadata first.

## Actual inputs, outputs and findings

### A. get_Passage — ordinary and long ranges

**P01:** `{"passage":"Genesis 6:14","depth":3,"word_depth":0,"etymology":0,"realworld":0}` → `status:ok`, 1 complete Hebrew and English verse, 14 ordered word tokens, shared lexicon, 3 passage and 3 verse connections; approx **8.7 KB** in archived response. PASS basic text/canonical token/depth behavior. **Discovery failure:** the top passage-level matches are two LXX *nest* translation bridges and a generic 1 Peter 3:20 editorial xref, not the text's distinctive `kaphar`/`kopher` cover/pitch relation.

**P02:** `{"passage":"Genesis 6:14","depth":1,"word_depth":2,"etymology":2,"realworld":1}` → `status:ok`, 1 verse with 1 passage/verse connection, two word connections stored under `lexicon.H3722.connections` and two under `lexicon.H3724.connections`. PASS depth limit through shared lexicon, not nested word arrays. **Warning:** `H3724` etymology describes `lemma:H3724D` as spelling variant of a village-root `H3723H`, although the word being analyzed is `lemma:H3724A` (pitch/ransom). This is a potentially irrelevant cross-sense inheritance. Its provenance is real, but it is misleading unless the source sense is disambiguated. `realworld=1` gave mainly a biblical dictionary definition, not necessarily an external empirical definition.

**P03:** `{"passage":"Zechariah 4:1-14","depth":5,"word_depth":0,"etymology":0,"realworld":0}` → `status:ok`, all **14** full verses, top five passage connections, ~**69.6 KB** in archived run. Results include Revelation 5:6 seven eyes and a meaningful lampstand LXX/NT bridge, but also 2 sleep-word LXX bridges and a `rouse ↔ spirit` grammatical relation. **Revelation 11:4's two olive trees should be more prominent for the entire chapter.** Its connection is reachable via a targeted tool, but not surfaced among the top five passage-level recommendations.

**P04:** `{"passage":"1COR12:10-1COR13:4","depth":10,"word_depth":0,"etymology":0,"realworld":0}` → `status:ok`, `pagination.total_verses=26`, `returned=26`, all requested verses with Greek/English text and ordered word entries; **150,229 bytes** in the archived response. Each verse has **at most 10** verse-level connections, no per-word connections at `word_depth=0`. PASS inclusive cross-chapter parsing, complete source text and z/x bounds. FAIL model-context efficiency: a large result from a common reading pattern, even with optional word expansion off. The main reason is many long repeated connection explanations and embedded lexical metadata.

**Pagination additional test:** `{"passage":"1COR12:10-1COR13:4","depth":0,"word_depth":0,"etymology":0,"realworld":0,"limit":2,"offset":24}` → returns exactly `1 Corinthians 13:3` and `13:4`, with `returned:2, has_more:false`. PASS.

**Psalm heading additional test:** `{"passage":"Ps 45:0","depth":0,"word_depth":0,"etymology":0,"realworld":0}` → returns Psalms 45:0, 1 heading with original tokens and WEB English. PASS.

### B. P0: wrong original-language data alignment — independently reproduced

**P05:** `{"passage":"Zechariah 4:2","depth":0,"word_depth":0,"etymology":0,"realworld":0}`.

Actual returned word entries include:

```json
{"pos":10,"word_id":59034,"form":"מְנוֹרַת֩","lemma":"מְנוֹרָה","strongs":"H4501","tr":"za.Hav","gloss":"a.lampstand","code":"HNcmsa","key":"H4501"}
{"pos":11,"word_id":79865,"form":"זָהָ֨ב","lemma":"זָהָב","strongs":"H2091","tr":"ku.Lah","gloss":"of.gold","code":"HNcmsc/Sp3fs","key":"H2091"}
{"pos":17,"word_id":110317,"form":"נֵרֹתֶ֨יהָ֙","lemma":"נֵר","strongs":"H5216","tr":"'a.Lei.ha","gloss":"lamps its","code":"HR/Sp3fs","key":"H5216"}
```

`za.Hav` is gold, not the transliteration of menorah. `ku.Lah` means all-of-it, not gold; `'a.Lei.ha` corresponds to upon-it, not lamps. The grammar code likewise appears attached to the wrong tokens.

**R02:** `research({"operations":[{"op":"passage_compare","id":"comparison","passages":["Zechariah 4:2","Revelation 11:4"],"limit":2}]})` → status `ok`; among 24 returned Zechariah 4:2 token records, **18 have a `lemma_key` prefix inconsistent with the record's own primary Strong's ID** (observed heuristic; source morpheme mappings may be multi-part, but the concrete counterexamples below are unambiguous). Example: the **menorah** token `H4501` carries `lemma_key:"lemma:H2091"` (**gold**). The gold token `H2091` carries `lemma_key:"lemma:H3605"` (**all**). The response includes 24 tokens with some skipped word positions and a null `word_id` on the last token.

**Source-code clue:** `supabase/functions/bible-mcp/discovery-v2-tools.ts`, inside the `get_Passage` word output mapper, uses `wordById.get(t.word_id)` from `get_words_batch`, then takes `wRow.transliteration` and `wRow.grammar_code` without checking they match `t.surface`/`t.strongs`. This can propagate mismatched source IDs. The *upstream cause* of these ID mismatches is not yet proven and must be traced through the compact verse token/morpheme crosswalk and B7 identity canaries.

**Acceptance gate:** Every word must have an identity-verified canonical occurrence ID, original surface, primary/extended Strong's, disambiguated lemma and suitable transliteration/grammar matched to *that token*. If a crosswalk is uncertain, return source data with a clear `unverified_alignment` status; do **not** silently attach another word's metadata. Add fixtures for Hebrew morpheme-heavy clauses, compound/preposition tokens, cross-verse spans, Greek, shifted Hebrew verses and Psalm superscriptions. P0 before claiming deep AI original-language accuracy.

### C. get_Word — useful but too much noise

**W01:** `{"word":"Ruach","connections":10,"etymology":3,"realworld":0}` → `status:ok`; about **14.4 KB**, `H7307` spirit/wind/breath, examples Genesis 1:2/Ezekiel 37/John 3/Zechariah 4, LXX `πνεῦμα`, `ἄνεμος`, `πνοή`, documented root/cognate, and standard Hebrew gematria `רוּחַ=214` with letter-by-letter arithmetic. PASS good broad research seeds; IMPROVE brevity, diverse sense evidence and structured candidate classes. Some returned occurrence clusters have `count:0` despite summaries saying e.g. 62 or 129 verses; this is ambiguous or inconsistent reporting.

**W02:** `{"word":"H3724","connections":0,"etymology":0,"realworld":0}` → `status:ok`; about **5.1 KB**, basic lexical data, LXX ransom candidates, exact spelled gematria `כפר=300`, three useful sample witnesses: Gen 6:14 pitch, Ex 21:30 ransom, Ex 30:12 ransom. PASS usefulness and zero connection list, although the output still contains long morphology forms and multiple cluster summaries; no explicit separate `senses[]` array.

**Additional homograph test:** `get_Word({"word":"eye","connections":3,"etymology":0,"realworld":0})` resolves Hebrew `H5869` (eye/sight) and exposes fountain/spring candidates plus Greek alternatives. PASS ambiguity awareness, but still preferentially picks a single primary lexeme. Optional deeper disambiguation warranted.

### D. get_Connection — strongest current discovery path, but narrow ranking

**C01:** `{"items":["Zechariah 4","Revelation 11:4"],"connections":8}` → `status:ok`; 8 candidate links, including multiple source-attested/editorial "two olive trees" cross-references, plus Hebrew→Greek two/olive/lampstand linguistic bridges. Passage inputs have compact verse previews without fully expanding every word. **PASS** specific intertext detection; **IMPROVE** duplicate xref grouping and distinguish literary dependence from editorial links.

**C02:** `{"items":["Revelation 13","Daniel 7"],"connections":10}` → `status:ok`; ten connections including sea-beasts, horns, dominion, cross-book editorial xrefs and LXX candidates. **PARTIAL**: the actual composite leopard–bear–lion imagery is not explained as the central whole-scene relationship; top links include vague anchors ("Then I saw", "was like").

**Additional Ezekiel test:** `{"items":["Ezekiel 1","Ezekiel 10"],"connections":10}` → 10 mostly overlapping editorial xrefs (hands, faces, amber, movement), but **misses the explicit identification** of the living creatures as cherubim in Ezekiel 10:20 among top 10. **FAIL** highest-value textual explanation priority.

**Additional three-way test:** `get_Connection({"items":["Zechariah 4:10","Matthew 6:22","Revelation 5:6"],"connections":10})` → eye LXX bridges and Revelation 5:6 identification appear, but not a synthesized eye-as-lamp motif with competing senses. **PARTIAL**. No evidence for a literal seven-spatial-directions identification was established by this test.

**Word-input shape:** `get_Connection({"items":["H3722","H3724"],"connections":3})` returns compact word summaries with gematria and sample witnesses but **omits the `grammar_forms` and full `occurrences` sections** returned by `get_Word`. Its nested word connections can exceed the requested top-level limit (4 each when top-level x=3). The owner's request for fully expanded word inputs is **not met exactly**.

### E. follow_connectionchain — works, but treats every arbitrary jump as a lead

**Exact safe flow:** `{"next":"Zechariah 4","limit":3}` → `status:ok`, private 64-character chain handle, current_node Zechariah 4, three suggested next links. Then `{"chain":"[PRIVATE]","next":"Revelation 11:4","action":"follow","limit":3}` → `status:ok`, current_node Revelation 11:4, path trail retained, epistemic class `exploratory_multi_step_chain`. `inspect` and `branch` also succeeded in separate earlier calls. Session expiry returned for following day.

**PASS** persistence, next-step navigation and an honest warning that paths do not automatically prove endpoint relationships. **IMPROVE:** direct, supported links should be attachable by evidence ID to each transition; the Zechariah→Revelation hop was merely `exploratory_step` with empty refs although the direct connection is known. No independent multi-user isolation/authorization test was performed; chain handles are never published.

### F. research — capable of many operations, but source alignment and payloads obstruct research

**R01:** Combined `gematria`/Corinth geography/`H7307` chronological occurrences request succeeded in an earlier parallel call and a subsequent **serial retry** (total ~**2.4 KB**), returning `רוּחַ=214`, `כֹּפֶר=300`, Corinth coordinates `37.905785,22.878741` and linked passages, and distinct Ussher-inspired chronology placement vs event axes. **One repetition under concurrent archive load failed** with `{"status":"error","error":"Research query execution failed."}`. This supports investigating load/error handling; it does **not** prove a persistent server error.

The `chronology_occurrences` schema currently lacks a caller-selectable chronology model/date interval/histogram, so it retrieves dated witness samples rather than answering the full requested "measure word occurrences through historical time" question. Geography linked passages include machine-like reference strings (`53:1:1`) and do not yet provide complete, role-filtered verse searches.

**R02:** Passage comparison `Zechariah 4:2` vs `Revelation 11:4` returns ~**11.8 KB** of verbose token, xref and context details for just two verses, including the P0 bad `lemma_key` associations. **FAIL AI-readable research compactness and integrity** until fixed.

A larger Zechariah 4 chapter comparison returned ~61 KB despite a small requested limit; `limit` currently bounds some result sets but does not consistently bound nested context.

### G. get_prompt and write_Note

**G01:** `get_prompt({})` returns `version:"2.0.0"` and ~**10.5 KB** of instructions. It is far longer than a simple tool guide and describes `depth` as overall retrieval scope, `word_depth` as grammatical/detail level and `realworld` as chronology/geography controls. Those descriptions **contradict the actual function schemas**: z caps passage/verse connections, x caps word connections, realworld toggles physical/world definitions. **FAIL concise accurate routing guidelines**. Fix prompt text before reusing it to guide other models.

**write_Note:** exposed with actions create/update/delete/save_dlm, but **not invoked** because the user requested testing rather than authorizing creation/modification/deletion of notes. Existence/schema confirmed; live write-authorization, ownership and DLM mutation behavior remain unverified.

## Specification scorecard

| Requirement | Verdict |
| --- | --- |
| Exactly 7 AI-facing tools | **PASS** |
| Complete passage / cross-chapter range / Psalm verse 0 | **PASS** in tested examples |
| z passage + per-verse, x per-word depth limits | **PASS** in tested scopes; via shared lexicon rather than nested entries |
| Optional y etymology and realworld | **PARTIAL**; cross-sense etymology contamination risk, physical external data not shown |
| Readable original, transliteration, grammar and English | **FAIL for accuracy**: confirmed misaligned Hebrew tokens |
| Interesting hidden connections in default passage view | **PARTIAL/FAIL**: real connections exist, but top rankings bury distinctive ones |
| Word insights, LXX, occurrence, gematria | **PARTIAL PASS**, sometimes verbose and not sense-disambiguated |
| Targeted multi-input connection comparisons | **PARTIAL PASS**; exact intertexts found, incomplete synthesis |
| Stateful chain without forced endpoint proof | **PARTIAL PASS**; persists, unverified hops remain hypotheses |
| Composable research including chronology/geography | **PARTIAL**; operations exist, temporal distributions and compactness incomplete |
| Brief accurate get_prompt | **FAIL** |
| write_Note safe existing behavior | **NOT TESTED** (no authorization for write test) |
| Performance/reliability under load | **PARTIAL**; one transient concurrent error and large payloads |

## Recommended next action (P0, then P1/P2)

1. **P0 first:** Trace `get_passage_compact_v1` token `word_id`, `get_words_batch` lookup and `lemma_key` source alignment. Add stringent cross-source identity checks, deterministic canaries (especially Zechariah 4:2), and safe fallback to trustworthy original token+lemma when extra metadata is unverified. Do not solve by hardcoding this verse. Cover Hebrew morphology, Greek, variant editions and shifted verses.
2. **P1:** Passage-first ranking that privileges explicit internal/same-book interpretations and unique combined imagery; merge duplicate editorial xrefs; show text of decisive target witness. Test Gen 6:14 covering/pitch, Zech4↔Rev11, Ezek1↔10:20, Rev13↔Dan7, 1 Cor 12–13. Keep hypothesis vs established text separate.
3. **P2:** Return *small* word capsules plus optional expansions. Hard cap nested connection descriptions; preserve exact requested verses and lexicon anchors, but avoid repeated verbose boilerplate. Give get_Connection words parity with get_Word when explicitly required; repair misleading lemma/sense inheritance. Make chain steps evidence-aware.
4. **P2:** Correct get_prompt documentation to actual flags and shorten. Improve chronology histograms/model filters, geography role filtering and readable reference IDs. Harden concurrent composite research failures.
5. Run short independent live checks after each change, then a separate broader benchmark; no need to rerun every R12 case during development.

**Bottom line:** This is a good foundation for *retrieving* biblical data, and get_Connection genuinely finds valuable parallels. It is not yet safe to rely on every returned original-language metadata field for **deep** exegetical claims. Source alignment and discovery selection should be repaired before trusting complex AI/DLM reasoning.
