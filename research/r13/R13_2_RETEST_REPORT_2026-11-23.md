# BibleResearch R13-discovery-2 — Independent Live MCP Retest

**Date:** 2026-11-23 | **Source:** connected production BibleResearch MCP, read-only.
**Compared:** `r13-discovery-1` → `r13-discovery-2`. The MCP release remains `2.0.0`.
**Previous worker:** `edd49ef6-44d8-4d0f-b398-f778568aa04c`.
**New worker:** `6d548f30-0666-4f88-84ff-24431ab7d443`.
**Reported source commit remains:** `838da3d84e1bcdb19ab9e5fff3dd1fb591474b09`.
**New corpus asset hash:** `e611b0c7b1b288f26fc1784f3abdf534b56ee0ebb490d8949818325e32f50fb9`.

**Exact tests and results:** [R13_2_RETEST_2026-11-23.json](R13_2_RETEST_2026-11-23.json). This includes all 44 original calls with parameters and top returned evidence IDs, 16 independent evidence/semantic checks, and four additional unseen holdouts.

## 1. Quantitative headline

| Metric | R13-1 | R13-2 | Change |
| --- | ---: | ---: | ---: |
| Expected target in top 5 (of 34) | 23/34 (67.6%) | **25/34 (73.5%)** | +2 cases |
| Expected target in top 10 | 27/34 (79.4%) | **29/34 (85.3%)** | +2 cases |
| Expected target in top 25 | 31/34 (91.2%) | **32/34 (94.1%)** | +1 case |
| Multi-anchor API connectivity | 6/10 | **10/10** | +4 cases |

**Interpretation:** A retrieval 'hit' means the target ID/title/ref appeared. It does not establish independent evidence quality or any new theological inference. A server-reported connected subgraph may still be a poor or misleading proof. The benchmark is a repeatable regression suite, not representative population-level accuracy.

## 2. Concrete improvements

- **Babel–balal wordplay:** H0894→H1101 and H1101→H0894 were entirely missing from the previous top 25, now rank **12** and **4**. Genesis 11:9 now returns `r13:wp:H1101:H0894` as #1 instead of an unrelated entity link.
- **Noah–comfort:** Genesis 5:29 improves #2→#1, still highlighting the two original Hebrew words in context.
- **Greek seed/word:** Luke 8:11 improves from a weak G3056 wordplay hit at #7 to a precise explicit identity `r13:interp:25365:eq7` at #1, with σπόρος G4703, λόγος G3056, and Θεοῦ G2316 highlighted.
- **Almond-shaped→almond:** H8246 seed improves #12→#5.
- **Scarlet:** H8144's Joshua 2:21 target moves #17→#8; natural-language `scarlet` #17→#10.
- **Strong's identity repair:** Jeremiah 1:11 position 4 correctly yields H0413 / word_id 33134 in both get_Passage and evidence hydration; baseline mismatched H0413 vs H2967.
- **Full almond/watch evidence:** The hydrated `r13:wp:H8247:H8245` now contains Jeremiah 1:11 and 1:12, with both original-language tokens highlighted.
- **Overclaim reduction:** H8245/H6918 (watch/holy) and H1818/H6924 (blood/east) now return epistemic `orthographic_similarity_only`, instead of `direct_textual_evidence`/attested wordplay. The previous r13 Babylon/Pekod and Ezekiel 37:5 false-identification evidence IDs are absent.
- **Septuagint:** Jeremiah 1:11 has 11 candidate alignments and Exodus 25:33 has 12; baseline zero. Both have **zero documented** alignments, so candidate quality remains unverified.
- **Chain traversal:** H8247→H8245 continues to attach a specific wordplay edge and now includes both required Jeremiah witnesses.

## 3. Graph reconstruction: clear API improvement, partial research improvement

All ten connectivity checks now match the expected API flags, versus six previously. The four recovered cases are:

| ID | Anchors | R13-1 | R13-2 | Manual proof assessment |
| --- | --- | --- | --- | --- |
| C02 | H8247/H8245/H8246 | Not connected | `r13:subgraph:triangle` | **Partly invalid motif shape:** the third independent edge is not demonstrated; duplicated H8247↔H8245 evidence is reused to claim a triangle. |
| C03 | Jeremiah 1 / Exodus 25 / Zechariah 4 / Revelation 5 | Not connected | `r13:steiner:network` | **Tentative:** true related source passages, but the supplied proof leans on editorial cross-references labelled 'shaped like', 'what do you see', and generic LXX 'see' vocabulary. No source-grounded almond→lamp→seven-eyes symbolic explanation. |
| C04 | Noah ark / atonement / Moses basket / 1 Peter baptism | Not connected | `r13:steiner:network` | **Problematic lexical identity:** Genesis 6:14 and Leviticus 16:30 treated as shared 'to atone' gloss for H3722 despite context-specific pitch/cover vs ritual atonement meanings. Several links are ordinary cross-references, not independently derived typology. |
| C05 | Genesis 2 / Ezekiel 37 / John 20 / Revelation 11 | Not connected | `r13:subgraph:diamond` | **Useful linked passages, limited synthesis:** actual cross-references connect all four; no unified multi-lingual breath/Spirit explanation, and unrelated Adam/ground wordplay is injected into the proof summary. |

**C01 remains a false-positive 'complete' result:** Adam/ground/blood reports 2 complete patterns, but neither explicitly assembles the intended Genesis 2:7 → Genesis 4:10–11 → Genesis 9:5–6 triangle. One co-occurrence pattern instead relies on Proverbs/Ezekiel witnesses.

## 4. Regressions and negative controls

- **Blood↔ground H1818→H0127** moved #5→#24 under the original exact wordplay ID. The original passage result lost the exact wordplay ID from its top 25, but the more cautious `r10:interp:gen4_10_11_blood_ground_echo` still appears **#2** in Genesis 4:10–11. This is partly a representation/ranking regression, **not a disappearance of the underlying thematic connection**.
- Adam→ground #2→#3; Jeremiah 1:11–12 target wordplay #3→#5.
- A negative test H1904/H3629 correctly remains disconnected.
- **False shared root still exists through a legacy lane:** `get_Connection({items:["H0894","H6489"]})` no longer exposes the old r13 false wordplay evidence, but still returns `r11:lex:H6489:0` as a `documented_lexical_relationship` claiming Babylon and Pekod share a root, with **no cited witness refs**. Removing an invalid r13 evidence ID was not a complete source-level fix.
- **New unseen Isaac/laugh holdout:** Genesis 21:6's top 16 misses the Isaac H3327 / laugh H6711 name connection; directly specifying both IDs finds a 2-way candidate. This shows continuing seed-only recall weakness.
- **New unseen Reuben name holdout:** Genesis 29:32 does not prominently explain the name Reuben H7205 as see H7200 + son H1121. A manually supplied 3-word query finds co-occurrences but does not build the name explanation.
- **New unseen Jonah test:** Jonah 1:17 ↔ Matthew 12:40 returns appropriate editorial cross-references and plausible LXX lexical bridges. However it does not explicitly recognize the NT's direct allusion/typology; one reverse day/night lexical bridge deserves manual audit.
- **Misclassified residual wordplays:** Genesis 29:32 seeded results include `r13:wp:H2029:H0223` (conceive ↔ Uriah) classified 'attested biblical wordplay' based on two letters in 2 Samuel 11:5–6. The generator can still overstate authorial intent.
- **Unreadable motifs:** some top result references still show `Verse N` and H####-only labels.

## 5. Evidence/semantic check audit

| Check | Result | Details |
| --- | --- | --- |
| EV01 | PASS | Jeremiah almond/watch includes both direct witness verses. r13:wp:H8247:H8245 now has Jeremiah 1:11 (H8247) and 1:12 (H8245). |
| EV02 | PASS | Canonical occurrence token parity. Jeremiah 1:11 position 4 now H0413, word_id=33134 in both get_Passage and research(evidence). |
| EV03 | PASS | Watch/holy evidence strength. r13:wp:H8245:H6918 now orthographic_similarity_only/proximate_wordplay_candidate, not attested wordplay. |
| EV04 | PASS | Blood/east evidence strength. r13:wp:H1818:H6924 now orthographic_similarity_only/proximate_wordplay_candidate. |
| EV05 | FAIL | Babylon/Pekod false derivation resolved at all layers. Old r13:wp:H0894:H6489 removed, BUT get_Connection(H0894,H6489) still returns r11:lex:H6489:0 'Lexical relation (shares root)' epistemic documented_lexical_relationship WITHOUT refs. |
| EV06 | PASS | Ezekiel 37:5 bones/breath false explicit identity removed. r13:interp:21519:dem not_found; get_Passage(Ezekiel 37:5) no incorrect explicit identity in top 7. |
| EV07 | PASS | Noah/comfort original text witness. r13:wp:H5146:H5162 highlights H5146 and H5162 together in Genesis 5:29. |
| EV08 | PASS | Luke 8:11 explicit seed/word identification. r13:interp:25365:eq7 highlights G4703, G3056, G2316; ranks #1 in get_Passage(Luke 8:11). |
| EV09 | PARTIAL | LXX candidate word alignments. Jeremiah 1:11 now 11 candidates; Exodus 25:33 now 12. Both have 0 documented alignments, candidate quality not independently verified. |
| EV10 | PASS | Chain evidence preservation. H8247->H8245 follow_connectionchain attaches r13:wp:H8247:H8245 with Jeremiah 1:11 and 1:12. |
| EV11 | FAIL | Multi-anchor triangle has independent edges. H8247,H8245,H8246 reported triangle includes wordplay and proximity of SAME H8247-H8245 edge; third independent H8245-H8246 textual edge not provided. |
| EV12 | FAIL | Adam-ground-blood full text-specific triangle. C01 complete_multi_anchor still relies on Ezekiel/Proverbs generic co-occurrence and Gen 4 blood-ground echo, not Genesis 2:7, 4:10-11, and 9:5-6 three-edge proof. |
| EV13 | FAIL | Covering/atonement sense preservation. C04 treats Gen 6:14 H3722 and Lev 16:30 H3722 as same 'to atone', collapsing context-distinct pitch/cover vs ritual atonement; bridge includes weaker generic crossrefs. |
| EV14 | FAIL | Unseen Isaac/laugh name wordplay seeded from passage. Genesis 21:6 top16 lacks Isaac↔laugh though direct get_Connection(H3327,H6711) can find the candidate via Genesis 21:5-6 and 26:8. |
| EV15 | FAIL | Unseen Reuben naming wordplay seeded from passage. Genesis 29:32 top16 lacks Reuben↔see↔son named derivation; explicit three-anchor call returns same-verse intersections, not semantic name explanation. |
| EV16 | PASS | Novel Jonah 1:17 ↔ Matthew 12:40 link. get_Connection finds explicit cross-reference and four plausible LXX lexical pairs; one additional inverse day/night pair seems suspect and needs review. |

These 16 checks include targeted regression tests and **new deeper semantic audits**. Their pass/fail total is not directly comparable with the ten R13-1 checks because the set and stringency differ.

## 6. Priorities for R13.2

1. **Verify the graph's returned edges**: expose ordered edge IDs, endpoint coverage, original-language witnesses and whether each is editorial-only, lexical, explicit or hypothesized. Reject cycle/triangle claims built from duplicate edges; reject all-anchor 'complete' claims without real per-edge coverage.
2. **Remove legacy false roots globally**: audit `r11:lex` as well as new r13 candidate layers; use source-verified lexical IDs; add Babel/Pekod as negative etymology holdout.
3. **Disambiguate verse-specific senses**: preserve H3722 context (Gen 6:14 pitch/cover vs Lev 16:30 ritual atonement) and prevent overconfident bridges.
4. **Improve automatic naming wordplay** using passage grammar and naming formulas; use Isaac/laugh and Reuben/see-son as *held-out* tests, not hardcoded rules. Preserve ability to discover unknown names.
5. **Complete cross-testament semantics**: derive formal structural pattern from original Hebrew/Greek rather than only modern editor references. Use independent LXX alignment verification and quote/self-interpretation detection.
6. **Penalize lexical hubs and unsupported claims**, retain exploratory formal similarities with appropriate labels. Deduplicate reciprocal edges and avoid spurious wordplay.
7. **MCP–website parity**: verify the live website graph uses the same release, graph IDs, ranked edges, and evidence; this retest observed MCP only and cannot claim visual graph parity.
8. **Evaluate novel unseen passages** beyond frozen smoke examples and add blind human relevance judgments. Do not optimize only the 44 known targets.

## 7. Per-case exact replay

### Word seeds (12)

| ID | Query | Old target rank | New target rank | Top returned evidence |
| --- | --- | ---: | ---: | --- |
| W01 | `H8247` | 1 | 1 | `r13:wp:H8247:H8245` |
| W02 | `H8245` | 1 | 1 | `r13:wp:H8245:H8247` |
| W03 | `H5146` | 3 | 3 | `r11:gram:H5146:grammatical_subject_of:H3205` |
| W04 | `H0120` | 2 | 3 | `r13:wp:H0120:H0121` |
| W05 | `H1818` | 5 | 24 | `r10:typo:exod12_passover_blood_christ_1cor5_7` |
| W06 | `H8246` | 12 | 5 | `r11:gram:H8246:modifies:H1375` |
| W07 | `H0894` | not found | 12 | `r11:gram:H0894:possessive_construction_with:H4428` |
| W08 | `H1101` | not found | 4 | `r11:gram:H1101:grammatical_object_of:H8193` |
| W09 | `H8144` | 17 | 8 | `r11:gram:H8144:possessive_construction_with:H8438` |
| W10 | `H8615` | 1 | 1 | `r11:gram:H8615:grammatical_object_of:H7194` |
| W11 | `H7307` | 1 | 1 | `r10:xlang:ruach_pneuma_anemos` |
| W12 | `H4501` | 1 | 1 | `r10:xlang:menorah_luchnia` |

### Passage seeds (12)

| ID | Query | Old target rank | New target rank | Top returned evidence |
| --- | --- | ---: | ---: | --- |
| P01 | `Jeremiah 1:11-12` | 3 | 5 | `r13:interp:19074:vis` |
| P02 | `Genesis 5:29` | 2 | 1 | `r13:wp:H5146:H5162` |
| P03 | `Genesis 11:9` | 3 | 1 | `r13:wp:H1101:H0894` |
| P04 | `Genesis 2:7` | 1 | 1 | `r10:wordplay:adam_adamah_gen2_7` |
| P05 | `Genesis 4:10-11` | 10 | not found | `r11:xref:90:30904` |
| P06 | `Exodus 25:33` | 4 | 4 | `r11:xref:2229:2624` |
| P07 | `Zechariah 4:10` | 1 | 1 | `r10:ident:rev5_6_eyes_spirits` |
| P08 | `Revelation 5:6` | 1 | 1 | `r10:ident:rev5_6_eyes_spirits` |
| P09 | `Revelation 1:20` | 1 | 1 | `r10:ident:rev1_20_lampstands_churches_control` |
| P10 | `Luke 8:11` | 7 | 1 | `r13:interp:25365:eq7` |
| P11 | `Genesis 6:14` | 2 | 2 | `r11:xref:152:30544` |
| P12 | `Ezekiel 37:5-10` | 3 | 3 | `r11:xref:21519:21523` |

### Natural language (10)

| ID | Query | Old target rank | New target rank | Top returned evidence |
| --- | --- | ---: | ---: | --- |
| N01 | `almond watching menorah seven eyes seven spirits` | 4 | 4 | `r11:intersect:pericope:19074:19075` |
| N02 | `Adam ground blood Abel Jesus` | 16 | 16 | `r11:gram:H1254:grammatical_object_of:H0120` |
| N03 | `scarlet` | 17 | 10 | `r11:gram:H8144:possessive_construction_with:H8438` |
| N04 | `scarlet Tamar Rahab Matthew 1` | 2 | 2 | `r11:intersect:pericope:1148:1144` |
| N05 | `well` | 6 | 6 | `r11:gram:H0875:possessive_construction_with:H4325` |
| N06 | `seed is the word of God` | 1 | 1 | `r11:intersect:verse:G4703:G3056:25365` |
| N07 | `breath` | 3 | 2 | `r10:xlang:ruach_pneuma_anemos` |
| N08 | `Babel confusion language Genesis 11` | 5 | 3 | `r11:gram:G1258:modifies:G2398` |
| N09 | `three days resurrection` | not found | not found | `r11:gram:G0386:possessive_construction_with:G3498` |
| N10 | `lily` | 7 | 7 | `r11:gram:H7799:possessive_construction_with:H4639` |


### Multi-anchor results (10)

| ID | Query inputs | Old API complete | New API complete | Full patterns returned |
| --- | --- | --- | --- | ---: |
| C01 | H0120 · H1818 · H0127 | yes/expected | yes | 2 |
| C02 | H8247 · H8245 · H8246 | no | yes | 1 |
| C03 | Jeremiah 1:11-12 · Exodus 25:33-37 · Zechariah 4:2-14 · Revelation 5:6 | no | yes | 1 |
| C04 | Genesis 6:14 · Leviticus 16:30 · Exodus 2:3 · 1 Peter 3:20-21 | no | yes | 1 |
| C05 | Genesis 2:7 · Ezekiel 37:5-10 · John 20:22 · Revelation 11:11 | no | yes | 1 |
| C06 | H5146 · H5162 | yes/expected | yes | 7 |
| C07 | H0894 · H1101 | yes/expected | yes | 6 |
| C08 | G4703 · G3056 | yes/expected | yes | 4 |
| C09 | H1818 · H0127 | yes/expected | yes | 9 |
| C10 | H1904 · H3629 | yes/expected | no | 0 |

**Reproduction:** replay the exact `args` from the linked JSON through the same connected MCP. `first_matching_rank` is the first returned ID/title/reference containing the frozen target substring; this is intentionally a *target-retrieval metric*, not full semantic relevance. Replay additional EV01–EV16 checks and inspect their cited original tokens. All 44 primary calls returned `status=ok`. No local code, SQL, worker deployment, or website UI was modified by this retest.
