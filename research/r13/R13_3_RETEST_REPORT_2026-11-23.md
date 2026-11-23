# R13-discovery-3 — Independent live MCP regression and evidence audit

**23 November 2026 · Production BibleResearch connected MCP**

- Tested corpus release: `r13-discovery-3`.
- Worker version: `fa4b7d1b-7977-47a9-afa2-c657e7535769`.
- Corpus assets SHA256: `fb41be32c11135a5aacdac7101907b2a7ba0878472742db4160518986d9fd422`.
- MCP release: `2.0.0`.
- Reported source commit: `6f70561b5487e5d1033cdd72fd9578ed8e63f239` (**not retrievable through the connected GitHub repository at time of test; verify source-to-deployment parity**).

[Full 44-case query replay, ranked returned results, five new holdouts and proof audits](R13_3_RETEST_2026-11-23.json) · [Previous baseline](R13_2_RETEST_REPORT_2026-11-23.md)

## Overall measured results

| Measurement | R13.2 | R13.3 | Change |
| --- | ---: | ---: | ---: |
| Target in top 5 (34 queries) | 25/34 (73.5%) | **29/34 (85.3%)** | +4 |
| Target in top 10 | 29/34 (85.3%) | **33/34 (97.1%)** | +4 |
| Target in top 25 | 32/34 (94.1%) | **34/34 (100.0%)** | +2 |
| Multi-anchor API connectivity match | 10/10 | **10/10** | unchanged |
| API query failures | 0/44 | **0/44** | unchanged |

Category breakdown of current top-five retrieval: word seeds 11/12; passage seeds 12/12; natural-language research 6/10. Natural language remains less reliably ranked.

**Limitations:** Hit@K is first target substring match in returned evidence IDs, titles or source references, not independently judged relevance. API connectivity match measures the server's claim. `graph_proof.is_valid` measures topological connectivity, not theological or literary intent. This is a frozen regression suite containing previously discussed cases, not representative population precision, and old-vs-new latency/load was not controlled.

## Main improvements

- Blood→ground H1818/H0127 recovered from target rank 24→4, and Genesis 4:10–11 target went from absent to #1.
- H8246→H8247 improved #5→#2; H0894→H1101 improved #12→#5 and H1101→H0894 #4→#3.
- Jeremiah 1:11–12 explicit almond/watch improved from #5→#2. Some formerly #1 passage targets now #2 due to a related self-interpretation taking #1.
- Natural-language `three days resurrection` now returns Hosea 6:2 at #2; the prior release missed it within top 25.
- The new `graph_proof` structure exposes typed independent edges with exact endpoints and witnesses. The H8247/H8245/H8246 example correctly returns a **2-edge tree** instead of falsely labeling it a three-edge triangle.
- Adam/ground/blood now reconstructs three separate anchor-pair relationships with Genesis 2:5–7, 4:10–11, and 9:5–6 evidence, with latter two edges honestly labeled `candidate_literary_pattern` at edge level.
- Formerly missing autonomous name research is substantially better: Isaac/laugh, Reuben/see-son, and Esau's physical description now appear #1 from passage seeds. Legacy Babylon/Pekod root error no longer appears in the comparison; H6489's lexical derivation now correctly points to H6485.
- Original-language hydration remains sound for Jeremiah 1:11 word #4: `H0413`, `word_id=33134` across passage and evidence. Jeremiah wordplay includes both necessary verses. The watch/holy and blood/east speculative comparisons stay classified as orthographic candidates, not attested wordplay.

## Edge-level graph proof audit

| Case | Graph topology | Independent evidence edges | Important limitation |
| --- | --- | ---: | --- |
| C01 | triangle (connected) | 3 | Composite result claims documented_lexical_relationship though 2 of 3 edges are candidate_literary_pattern; distinguish topology from evidential certainty. |
| C02 | steiner_tree (connected) | 2 | Second morphological edge witness_refs empty; show lexical documentation and contextual Exodus witness. |
| C03 | cycle_network (connected) | 5 | Connectivity should not imply coherent almond→menorah→seven-eyes meaning. Generic 'four' and 'see' inflate graph. |
| C04 | steiner_tree (connected) | 3 | Gen6 H3724 is pitch in context, displayed as 'ransom'; no unambiguous typology proof from lexical root alone. |
| C05 | cycle_network (connected) | 5 | Plausible research path, but cross-language parallels and editorial crossref do not automatically prove literary dependence. |

Do not calculate a graph's epistemic label from its strongest edge alone. C01 is topologically a triangle but two edges are not documented etymologies; it must not receive an aggregate documented-lexical claim. C02's morphological link should cite the actual lexical-source evidence and supporting verse. C03's 'see' and 'four' are generic connective edges, not sufficient explanation of almond/lampstand/seven eyes. C04's Genesis 6:14 pitch sense differs from 'ransom' despite the displayed H3724 gloss. C05 connects valid cross-language vocabulary but authorial reliance remains unproven.

## New independent probing outside the frozen 44

| ID | Seed | Expected pattern | Rank | Result |
| --- | --- | --- | ---: | --- |
| U05 | Amos 8:1-2 | summer fruit H7019 ↔ end H7093 in Amos 8:1-2 | 1 | PASS |
| U06 | Genesis 30:24 | Joseph H3130 ↔ add H3254, ideally with gathered H0622 | 1 | PASS |
| U07 | Genesis 29:34 | Levi H3878 ↔ joined H3867 | 1 | PASS |
| U08 | Genesis 16:11 | Ishmael H3458 ↔ heard H8085 | 1 | PASS |
| U09 | Judges 15:19 | En Hakkore name H5875 explained by calling/cried; avoid 'the day' H3117 | 1 | FAIL |

Four of five extra probes found the desired name or original-language wordplay prominently. These are additional exploratory holdouts, not a random statistically representative sample. U09 **failed seriously**: Judges 15:19 `r13:interp:6949:birthname:H3117` treats `הַיּוֹם` ('the day') as a name being explained; the actual name is En Hakkore (H5875 in the passage), followed by the temporal phrase 'to this day'.

## Detailed evidence audits

| ID | Status | Finding |
| --- | --- | --- |
| A01 | **PASS** | Attested almond/watch witness and canonical token parity. Jeremiah 1:11 and 1:12 original tokens H8247 and H8245 highlighted; Jer 1:11 word#4 H0413, word_id33134 identical across get_Passage and research(evidence). |
| A02 | **PASS** | Reduce overclaim blood/east and watch/holy. r13:wp:H1818:H6924 and r13:wp:H8245:H6918 are orthographic_similarity_only; preserved as exploratory candidates. |
| A03 | **PASS** | Remove erroneous Babylon/Pekod lexical root. get_Connection(H0894,H6489) still reports authentic cooccurrence Ezekiel 23:23, but no longer r11:lex:H6489:0 root to Babylon; hydrated r11:lex:H6489:0 now refers to H6485 instead. |
| A04 | **PASS** | Remove erroneous Ezekiel bones=breath explicit identity. r13:interp:21519:dem not_found. |
| A05 | **PASS** | Restore blood↔ground retrieval. get_Word(H1818) target r13:wp:H1818:H0127 rank24→4; get_Passage(Genesis 4:10-11) target absent→rank1. |
| A06 | **PASS** | Original-language name discovery. Genesis 21:6 Isaac/laugh #1; Genesis 29:32 Reuben/see+son #1; Genesis 25:25 Esau appearance #1 (but 'explicit interpretation' claim is debatable). |
| A07 | **PASS** | Correct graph topology. H8247,H8245,H8246 outputs a two-edge Steiner tree, not false three-edge triangle; Adam/ground/blood triangle returns three distinct anchor-pair edges with Gen 2/4/9 witnesses. |
| A08 | **PARTIAL** | Multi-anchor proof reliability. Graph_proof verifies topology; C01 aggregate overclaims documented_lexical_relationship with two candidate_literary_pattern edges; C03 includes trivial 'see' and 'four' edges as if meaningful prophetic pattern. |
| A09 | **PARTIAL** | LXX alignments. Jeremiah 1:11 11 candidate and Exodus 25:33 12 candidate alignments, 0 documented both; correctness of candidate pairs not independently vetted. |
| A10 | **FAIL** | Proper-name formula false positive. Judges 15:19 incorrectly gives explicit-identification r13:interp:6949:birthname:H3117 where H3117 means 'the day', while H5875 is En Hakkore and name occurs before 'to this day'. |
| A11 | **FAIL** | Greek lexical identity/sense mismatch. get_Word G2495 (Ἰωνᾶς Jonah) returns lemma_key lemma:G2491K and gloss John; get_Passage(Matthew 12:40) says Jonah correctly. Likely verse-vs-lexicon mismatch. |
| A12 | **FAIL** | Vision interpretation mixes unrelated verses. r13:interp:22600:vis takes Amos + basket + summer fruit/end from Amos 8:2 as explicitly identified with wailing, songs, temple, bodies from Amos 8:3; genuine summer/end wordplay separately appears correctly. |
| A13 | **PARTIAL** | Gen 6:14 pitch vs atonement context. New graph uses root/wordplay H3724 'ransom' ↔ H3722 'atone', while Genesis 6:14 H3724 is 'pitch'; connectedness accurate but lexical sense and authorial intent remain unresolved. |
| A14 | **PASS** | Additional positive wordplay seeds. Amos 8:1-2 summer/end #1; Gen 30:24 Joseph/add #1; Gen 29:34 Levi/join #1; Gen 16:11 Ishmael/hear #1. |
| A15 | **FAIL** | Unseen Judges 15:19 name derivation. Expected En Hakkore name explanation; top result is false 'day' naming identification; valid name clue not surfaced as coherent explanation. |
| A16 | **PARTIAL** | Jonah–Matthew explicit typology. Jonah 1:17 vs Matthew 12:40 yields explicit typological-citation candidate rank8 and bilingual lexical bridges, but top result remains editorial xref, and G2495 'Jonah' is misglossed John. |
| A17 | **UNKNOWN** | MCP–website graph parity. Production website interaction and equality of graph engine and ranking were not independently checked in this retest. |
| A18 | **UNKNOWN** | GitHub/source traceability. Live version source_commit 6f70561b5487e5d1033cdd72fd9578ed8e63f239 was not retrievable via connected GitHub repository at test time; corpus and Worker release fields confirmed. |

### Critical newly found lexical identity defect

`get_Word({word:'G2495'})` resolves Greek `Ἰωνᾶς` (*Jonah*) with `lemma_key:'lemma:G2491K'` and primary gloss **John**. The original token in `get_Passage({passage:'Matthew 12:40'})` is correctly Jonah, as is the Greek surface. This is a canonical lemma/sense crosswalk problem that contaminates `get_Connection(Jonah 1:17, Matthew 12:40)` (bridge title incorrectly says Jonah→John). Fix source lexical identity before relying on Greek entity-bridge assertions.

### Critical residual interpretation problems

- `r13:interp:22600:vis` merges Amos 8:2's fruit/end vision with items from Amos 8:3, asserting explicit identity between Amos/basket/fruit/end and wailing/songs/temple/bodies. Preserve actual *qayits/qets* wordplay while preventing a later narrative consequence from becoming the identity target.
- Judges 15:19's `r13:interp:6949:birthname:H3117` misidentifies a temporal phrase as a proper name.
- `r13:interp:684:birthname:H6215` treats Esau's redness/hairiness as explicit identification rather than a contextual description; textual naming association is valid, but historical etymology and precise relation type must be distinguished.
- A few generated old `attested biblical wordplay` candidates still appear driven by letter overlap and contextual cues rather than direct linkage (e.g. names in nearby scenes). Keep as exploratory candidates until independently supported.

### LXX results

Jeremiah 1:11 still returns 11 *candidate* alignments; Exodus 25:33 returns 12. Both return zero *documented* alignments. Do not call these verified scholarly token alignments; more validation is needed.

## Suggested next focus, in priority order

1. **Canonical Greek word/lemma repair:** G2495 Jonah misclassified as John via `lemma:G2491K`. Add end-to-end occurrence/lexicon/verse proof equality tests, across Hebrew and Greek.
2. **Clause-bounded interpretation typing:** enforce proper-name identification, explanation target, discourse scope and clause roles; prevent `to this day` and consequences of a vision from becoming identity explanations.
3. **Aggregate evidence calibration:** topological verification must not be conflated with semantic verification. Whole-graph class/strength should reflect weakest essential edge, explicit uncertainty, citations, and tests of alternate interpretations.
4. **Context-specific glosses and root claims:** Gen 6:14 H3724 is pitch; Lev 16:30 H3722 is atonement. Show contextual gloss, morphology, root documentation and possible literary interpretation as separate fields.
5. **Semantically coherent multi-passage synthesis:** penalize high-frequency 'see', number 'four', and unspecific editorial links in thematic networks. Require thematic/structural relation explanations and source anchors.
6. **Seed recall & novel holdouts:** preserve 4/5 successful new wordplay probes; improve Judges 15:19 while adding never-seen cases and negative lexical controls. Do not hardcode cases.
7. **MCP/website parity:** verify both surfaces use the same versioned graph evidence and ranking; UI was not independently verified here.
8. **Source traceability:** reconcile reported source commit with GitHub. Do not claim code-to-deployment parity without a retrievable matching commit.

## Verification protocol

The companion JSON preserves the exact input arguments for all 44 frozen queries and top-25 retrieved evidence IDs, titles and refs, along with the graph case outputs and manually audited proof edges. Repeat after next release, then rerun new fresh held-out seeds and identity/interpretation negative controls. No writes to biblical data, SQL, or deployment were performed by this benchmark. Only the benchmark report files were saved on GitHub.
