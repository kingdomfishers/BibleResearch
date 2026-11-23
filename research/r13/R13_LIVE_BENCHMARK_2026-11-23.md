# R13 independent live benchmark — 23 November 2026

**Verified production:** corpus `r13-discovery-1`; MCP `2.0.0`; source `838da3d84e1bcdb19ab9e5fff3dd1fb591474b09`, worker `edd49ef6-44d8-4d0f-b398-f778568aa04c`. No mutation to the production corpus or SQL. This report is a frozen independent ChatGPT live-tool benchmark, not a claimed official CI run.

The [machine-readable exact-call manifest](R13_LIVE_BENCHMARK_2026-11-23.json) stores every tool, exact argument object, expected target, rank, top-ranked evidence ID and each diagnostic.

## Results and interpretation

- **34 seeded discovery queries:** target retrieved within top 5: **23/34 (67.6%)**; within top 10: **27/34 (79.4%)**; within top 25: **31/34 (91.2%)**.
- **10 multi-anchor / negative-control queries:** API-reported `all_endpoints_connected` matches expected in **6/10**. This does NOT guarantee a complete witness-bearing path.
- **10 focused evidence/contract assertions:** **3/10 pass**, **7/10 fail**; deliberately defect-heavy, not a population-wide accuracy estimate.
- All 44 query calls completed with `status=ok`; evidence and LXX checks also returned results.

**Critical interpretation:** Retrieval hit rates are optimistic because matching a target ID, title or cited reference can succeed through a weak lead. Examples P03 (Babel passage returns the *balal* lemma only through a grammatical relation), P10 (Greek `G3056` appears within unrelated wordplay), and N04 (Matthew 1:5 cited without a reconstructed Tamar/Rahab/scarlet genealogy) are *not* full semantic discoveries.

## A. Single-word seed retrieval (12 cases)

| ID | Input | Expected target | First match | Outcome |
|---|---|---|---:|---|
| W01 | `H8247` | `r13:wp:H8247:H8245` | 1 | Top 5 |
| W02 | `H8245` | `r13:wp:H8245:H8247` | 1 | Top 5 |
| W03 | `H5146` | `r13:wp:H5146:H5162` | 3 | Top 5 |
| W04 | `H0120` | `r10:wordplay:adam_adamah_gen2_7` | 2 | Top 5 |
| W05 | `H1818` | `r13:wp:H1818:H0127` | 5 | Top 5 |
| W06 | `H8246` | `H8247` | 12 | Top 25 |
| W07 | `H0894` | `H1101` | — | MISS |
| W08 | `H1101` | `H0894` | — | MISS |
| W09 | `H8144` | `Joshua 2:21` | 17 | Top 25 |
| W10 | `H8615` | `Joshua 2:18` | 1 | Top 5 |
| W11 | `H7307` | `G4151` | 1 | Top 5 |
| W12 | `H4501` | `Zechariah 4:2` | 1 | Top 5 |

**Word-only:** Top5 8/12; Top10 8/12; Top25 10/12. **Crucial failure:** Babel (H0894) does not retrieve *balal* (H1101), nor vice versa, although the pair is directly co-attested in Genesis 11:9.

## B. Passage seed retrieval (12 cases)

| ID | Input | Expected target | First match | Outcome |
|---|---|---|---:|---|
| P01 | `Jeremiah 1:11-12` | `r13:wp:H8247:H8245` | 3 | Top 5 |
| P02 | `Genesis 5:29` | `r13:wp:H5146:H5162` | 2 | Top 5 |
| P03 | `Genesis 11:9` | `H1101` | 3 | Top 5 |
| P04 | `Genesis 2:7` | `r10:wordplay:adam_adamah_gen2_7` | 1 | Top 5 |
| P05 | `Genesis 4:10-11` | `r13:wp:H1818:H0127` | 10 | Top 10 |
| P06 | `Exodus 25:33` | `H8246` | 4 | Top 5 |
| P07 | `Zechariah 4:10` | `Revelation 5:6` | 1 | Top 5 |
| P08 | `Revelation 5:6` | `r10:ident:rev5_6_eyes_spirits` | 1 | Top 5 |
| P09 | `Revelation 1:20` | `r10:ident:rev1_20_lampstands_churches_control` | 1 | Top 5 |
| P10 | `Luke 8:11` | `G3056` | 7 | Top 10 |
| P11 | `Genesis 6:14` | `Exodus 2:3` | 2 | Top 5 |
| P12 | `Ezekiel 37:5-10` | `Revelation 11:11` | 3 | Top 5 |

**Passage-only:** Top5 10/12; Top10 12/12. False positive interpretation P03/P10 must be reviewed, not counted as proof.

## C. Natural-language research (10 cases)

| ID | Input | Expected target | First match | Outcome |
|---|---|---|---:|---|
| N01 | `almond watching menorah seven eyes seven spirits` | `r10:ident:rev5_6_eyes_spirits` | 4 | Top 5 |
| N02 | `Adam ground blood Abel Jesus` | `r10:wordplay:adam_adamah_gen2_7` | 16 | Top 25 |
| N03 | `scarlet` | `Joshua 2:21` | 17 | Top 25 |
| N04 | `scarlet Tamar Rahab Matthew 1` | `Matthew 1:5` | 2 | Top 5 |
| N05 | `well` | `Genesis 24:13` | 6 | Top 10 |
| N06 | `seed is the word of God` | `Luke 8:11` | 1 | Top 5 |
| N07 | `breath` | `Genesis 7:22` | 3 | Top 5 |
| N08 | `Babel confusion language Genesis 11` | `Genesis 11:9` | 5 | Top 5 |
| N09 | `three days resurrection` | `Hosea 6:2` | — | MISS |
| N10 | `lily` | `Psalms 45:0` | 7 | Top 10 |

**Natural language:** Top5 5/10; Top10 7/10; Top25 9/10. In `well`, the #1 result is the Lamb's seven eyes, a query-disambiguation error. In `breath`, the first two results are seven Spirits/lamp symbols rather than creation/flood breathing. `three days resurrection` fails to surface Hosea 6:2 within top 25.

## D. Multi-anchor evidence structure (10 cases)

| ID | Inputs | Expected complete connectivity | Returned | `complete_multi_anchor` | Assessment |
|---|---|---|---|---:|---|
| C01 | H0120; H1818; H0127 | true | true | 2 | API PASS |
| C02 | H8247; H8245; H8246 | true | false | 0 | API FAIL |
| C03 | Jeremiah 1:11-12; Exodus 25:33-37; Zechariah 4:2-14; Revelation 5:6 | true | false | 0 | API FAIL |
| C04 | Genesis 6:14; Leviticus 16:30; Exodus 2:3; 1 Peter 3:20-21 | true | false | 0 | API FAIL |
| C05 | Genesis 2:7; Ezekiel 37:5-10; John 20:22; Revelation 11:11 | true | false | 0 | API FAIL |
| C06 | H5146; H5162 | true | true | 7 | API PASS |
| C07 | H0894; H1101 | true | true | 3 | API PASS |
| C08 | G4703; G3056 | true | true | 4 | API PASS |
| C09 | H1818; H0127 | true | true | 11 | API PASS |
| C10 | H1904; H3629 | false | false | 0 | API PASS |

**Graph synthesis problem:** C01 is a misleading success. Its `complete_multi_anchor` includes `intersect:H0120+H1818+H0127` (nearby-word matches Proverbs and Ezekiel) plus a Genesis 4:10–11 blood/ground echo. Neither is a complete evidence trail for the desired Genesis 2:7 → 4:10–11 → 9:5–6 triangle. C03–C05 return many pairwise links but no complete 4-anchor graph. This is the main architectural deficiency.

## E. Evidence identity, classification and LXX coverage

| ID | Assertion | Result | Actual evidence |
|---|---|---|---|
| E01 | Almond–watch proof must include Jeremiah 1:11 AND 1:12 | **FAIL** | Evidence r13:wp:H8247:H8245 only contains Jeremiah 1:11; H8245 isn't highlighted. |
| E02 | Watch/holy must not be labeled attested wordplay without a real exegetical cue | **FAIL** | r13:wp:H8245:H6918 is direct_textual_evidence / attested_textual_wordplay, showing only Isaiah 29:19 with H6918 highlighted. |
| E03 | Blood/east consonantal similarity is not established wordplay | **FAIL** | r13:wp:H1818:H6924 is direct_textual_evidence / attested_textual_wordplay, Leviticus 16:14; 2 shared consonants. |
| E04 | Babylon/Pekod must not assert documented common root without a valid source | **FAIL** | r13:wp:H0894:H6489 states documented_root_family, proven_common_root=true, shared_consonants="". |
| E05 | Ezekiel 37:5 bones and breath should not be identified as equivalent | **FAIL** | r13:interp:21519:dem relation=explicit_identification and type=explicit_biblical_interpretation; text describes entry of breath into bones. |
| E06 | Noah/comfort original occurrence pair attested in Gen 5:29 | **PASS** | r13:wp:H5146:H5162 evidence Genesis 5:29 highlights H5146 and H5162. |
| E07 | Canonical token parity: Jeremiah 1:11 position 4 | **FAIL** | get_Passage Strong H0413, research(evidence) Strong H2967 for the same Hebrew form אֵלַי. |
| E08 | Evidence retrieval hydrates original words and witnesses | **PASS** | r13 wordplay evidence has original_tokens and provenance; completeness and exact identity are separately failed. |
| E09 | Evidence-backed chain traversals attach known edges | **PASS** | H8247→H8245 attached edge r13:wp:H8247:H8245 with direct_textual_evidence and Jeremiah 1:11. |
| E10 | Jeremiah 1:11 and Exodus 25:33 LXX token alignments | **FAIL** | research(lxx, mode=compare) both return 0 documented and 0 candidate word alignments; verse-level pairing exists. |

## Historical R12/R13 contrast

The pre-R13 [R11 discovery evaluation](../r12/DISCOVERY_PRODUCT_EVAL_2026-11-17.md) already found scarlet witnesses, weak natural-language proper-name resolution, source proof mismatches, and arbitrary graph paths. R13 now introduces independently found Noah-name wordplay, explicit typed evidence IDs, hydrated original-language evidence, evidence-aware chain navigation, and distinct multi-anchor fields. These are observed qualitative improvements. **Do not claim a numerical percentage improvement over R12**: there is no replayable original release endpoint and identical R12 baseline here.

## High-leverage R13.1 priorities (in order)

1. **P0 occurrence parity and proof integrity:** one canonical word ID per source token; hydrate every required witness; stop labeling conjectural roots and wordplay as established. Add context-bound symbol identification guards.
2. **P1 seed recall using multichannel retrieval:** reuse [Tesserae v6](https://github.com/tesserae/tesserae-v6) techniques (rare lemmas, n-grams, sound, edit distance, syntax, semantic and fusion), keeping resemblance as candidate evidence. Test missing Babel/balal with no hardcoding.
3. **P1 Hebrew parallel-verse retrieval:** evaluate [MiqraBERT](https://huggingface.co/davidmsmiley/MiqraBERT) offline; use [T’OMIM](https://huggingface.co/datasets/NuBerea/tomim) for reproducible positive/negative parallel-passage tests. Neither model similarity nor dataset presence proves authorial intent.
4. **P1 typed graph motif + bounded Steiner connecting:** find a verified connected subgraph, not a bag of separate pairs. Every edge needs source/target occurrence, role and witness IDs; try NetworkX Steiner approximate on a bounded graph offline, then port a lightweight implementation as needed.
5. **P1 name/entity linking:** [STEPBible TIPNR](https://stepbible.github.io/STEPBible-Data/) for individual persons and genealogies; preserve common-noun/name homographs for exploration without conflation.
6. **P2 commentary/intertext candidates:** [Sefaria Links API](https://developers.sefaria.org/reference/get-links), or periodic [Sefaria Export](https://github.com/Sefaria/Sefaria-Export) in a separate secondary commentary layer, with license checks.
7. **P2 optional linguistic resource:** Open Scriptures [HebrewLexicon/BDB](https://github.com/openscriptures/HebrewLexicon) (CC BY 4.0). ETCBC BHSA provides further syntax/parallels but its DATA is CC BY-NC 4.0; check commercial compatibility. CATSS MT-LXX word-aligned data has a separate restrictive use agreement; do not assume free redistribution.
8. **Validate gains:** run same exact 44 queries on R13.1, then an *unseen* held-out gold set using pairwise relevance and proof-completeness labels; compute precision@5 and nDCG only with independently judged relevances.

## Method caveats

Results were collected with actual connected BibleResearch tools on 2026-11-23. Tool descriptions, arguments, test expectations, and ranks are in JSON. Word/passage/natural-query ranks are first substring match over result IDs, titles or returned witness reference lists—**not manually evaluated truth**. Direct/complete connectivity uses server-reported flags; C01 was explicitly audited as inadequate despite API PASS. The dataset contains previously discussed examples, so it is a regression smoke benchmark, not an untouched holdout. No load test, UI test, source diff, full legacy R12 rerun, or automated grading on the entire biblical graph was performed.

