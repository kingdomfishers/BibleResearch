# BibleResearch R12 — Independent Live Verification and Next-Improvement Report

**Date:** 2026-11-19 (Europe/Zurich)  
**Scope:** Read-only verification of the new deployed R12 discovery engine and independent recomputation of the GitHub 239-case result ledger.  
**Target branch:** `feat/r12-qa-fixes` (latest evaluated benchmark commit: `a349398dc6a9a42e473262cbbcc35ae96da4efce`).  
**Production deployment verified live:** MCP `1.8.0`; corpus release `r12-discovery-2`; Worker `cce819e9-60d4-4e17-bb01-ed138af9a9a3`; source commit `d9940058651c83befa168a2f31e60fca0c691414`; asset SHA-256 `7a08727be4d841e4aded1f0aeb5300c9d79e32769d30ba1968726d413f630a11`.  
**Existing complete run:** [R12_RETEST_EVALUATION_REPORT.md](R12_RETEST_EVALUATION_REPORT.md), [R12_MCP_RETEST_ALL_239.json](R12_MCP_RETEST_ALL_239.json), [EVIDENCE_SPOT_CHECKS.json](EVIDENCE_SPOT_CHECKS.json).  
**Earlier baseline:** [R12_BENCHMARK_DIAGNOSIS.md](../R12_BENCHMARK_DIAGNOSIS.md). Frozen cases: [R12_EXPECTED_CONNECTIONS_180_PLUS.json](../R12_EXPECTED_CONNECTIONS_180_PLUS.json).  
**Method distinction:** The **239-case live run** was already saved on GitHub. This follow-up **independently recomputed its row-level metrics** and conducted **30 fresh live discover requests covering 21 distinct query intents**, including the key benchmark regressions, negatives and new prophetic/research probes, plus **8 distinct successful live evidence-ID inspections**. It is **not a second complete 239-call execution** or a blind claim of independently validated semantic recall.

## Executive conclusion

**Verdict: substantial retrieval improvement, still below the bar for an autonomous, trustworthy discovery engine.** The deployment can find grounded intertextual and wordplay leads and has removed the four known absurd lexical-bridge endpoint results. However, it disproportionately rewards low-level grammar/LXX facts, fails to keep governing query concepts and passage scenes in focus, and can label a *real* co-occurrence with the *wrong sense* or attribute a *real* cross-language equivalent to *shared root derivation*. Some source quotations are perfectly real while the **connection asserted about them is not**. Relevance, evidence typing and explanation—not merely more graph edges—are now the primary quality bottleneck.

**Product criterion:** A successful discovery should give a reader an *interesting, non-obvious, inspectable relationship*: exact passage(s), intelligible Hebrew/Greek transliteration/gloss, the typed steps tying claims together, contextual scene/role correspondence, independent evidence and explicit competing explanations. An uncontextualized lemma, shared gloss, xref or 3-hop path is a lead, not proof of a meaningful authorial pattern.

## 1. Independently recomputed 239-case results

I fetched and programmatically parsed the **actual saved** `R12_MCP_RETEST_ALL_239.json` rows and recomputed top-five family distributions and positive target counts without trusting the prose report as the source of the numbers. They match the full-case figures in the accompanying evaluation report.

| Measure | Baseline `r12-discovery-1` | Current `r12-discovery-2` | Interpretation |
|---|---:|---:|---|
| Cases / positive / negative | 239 / 215 / 24 | **239 / 215 / 24** | Same frozen expectation set |
| Strict expected Strong's/verse target within case top-K | **98/215 (45.6%)** | **136/215 (63.3%)** | +38 net / +17.7 percentage points; **retrieval proxy only** |
| Range-aware expected target within top-K | not comparably measured | **137/215** | Verse-span handling changes one strict screen |
| Target visible only *after* top-K, within top-25 | — | **17/215** | Likely ranking/displacement |
| No exact target visible within returned top-25 | — | **61/215** | Candidate generation, filtering, index coverage or extreme displacement; requires tracing |
| Source and expected target displayed together on one card within top-K | not measured | **43/215** | Co-presence alone does not validate the mechanism |
| Direct intertext expected target within top-K | **4/55** | **25/55** | Biggest absolute category gain |
| Narrative pattern expected target within top-K | **18/54** | **27/54** | Real but incomplete improvement |
| Narrative genealogy expected target within top-K | **0/3** | **0/3** | Still blocked |
| Initial MCP HTTP 503s in serial production run | **0/222** | **7/190** | Seven contiguous failures subsequently recovered |
| Distinct query payloads producing final successful result | 222/222 | **190/190** after retries | Recovery is not first-pass reliability |

Category splits independently reproduced from the current row ledger: linguistic form **5/5**, lexical **18/23**, polysemy **5/5**, translation **21/22**, direct intertext **25/55**, narrative chronology **3/8**, narrative pattern **27/54**, genealogy **0/3**, material **9/14**, part/whole **3/4**, process **11/12**, property **9/10** (strict source/target screen).

**Top-five occupancy, recomputed over all 239 × 5 = 1,195 displayed slots:**

- `r11:gram` **385 (32.2%)**; `r11:lxx` **376 (31.5%)**; **761/1,195 (63.7%) combined**.
- `r12:path` **200 (16.7%)**, `r11:xref` **39 (3.3%)**, `r12:prop` **8 (0.7%)**, `r11:cluster` **3 (0.3%)**. Remaining slots are spread across R10 and other R11 families.
- The ledger's `summary.top5_slot_counts` sums to **950 = 190 unique queries × 5**. It must **not** be used with the **1,195 case-row** denominator. Both are useful, but use a matching denominator and document query deduplication when comparing trends.

**Important measurement limit:** Expected IDs and references are frozen *research targets*, not gold-standard proofs. `target@K` is **not** semantic precision, connection correctness, novelty, or theological validity. A dramatic score improvement can coexist with misleading explanations or off-topic passage choices. Keep strict target, paired-witness, mechanism-verified, negatives and first-pass reliability as **separate** measures.

## 2. Additional live tests of the actual deployment

All fresh discovery calls in this session resolved to the exact production release listed above. Across **30 live `discover_biblical_connections_v2` requests** (21 distinct query intents; some repeated for inspection), **zero requests returned an HTTP 503**. This small test does **not** negate the saved seven-request production outage burst. The eight valid evidence IDs were inspected with `get_connection_evidence_v1`.

### Positive and regression spot checks

| Input / benchmark | Fresh observed result | Assessment |
|---|---|---|
| `Genesis 1:1` (`D001`) | Exact Genesis 1:1 ↔ John 1:1–3 `r11:xref:1:26152` is **#20**; routine grammar/LXX takes much of top 10 | **Ranking failure**, target exists |
| `Genesis 6:18` (`D006`) | Genesis 6:18 ↔ Hebrews 11:7 `r11:xref:156:30279` **#2** | Useful indexed intertext; no proof of historical dependence |
| `Exodus 12:15` (`S001`) | grammar/LXX #1–5; Exodus 12:15 ↔ Galatians 5:12 `r11:xref:1832:29274` **#6**; requested Red Sea chronology absent | **Major relevance failure** |
| `Exodus 14:30` (`S006`) | sea-shore grammatical relations #1–5; baptism/1 Corinthians 10 connection absent from top 25 | **Passage→event routing failure** |
| `2 Kings 2:14` (`S009`) | Exact Elijah 2 Kings 2:8 parallel `r11:xref:9566:9560` **#14**; unrelated Genesis 1:2↔8:1 wind/water correspondence **#3** | **Scene-ranking failure** |
| `Hosea 6:2` (`S018`) | Hosea 6:2 ↔ 1 Corinthians 15:4 `r11:xref:22286:28823` **#4** | Grounded comparison; not a demonstrated explicit quotation |
| `Zechariah 4:6` (`S035`) | Zechariah lampstand/olive oil/Spirit motif in `r10:corresp:zech4_menorah_oil_spirit_eyes` **#3**, but intended connected Revelation witness not sufficiently integrated | **Partial motif retrieval** |
| `Ezekiel 47:1` (`S050`) | Ezekiel 47:1 ↔ Revelation 22:1 `r11:xref:21797:31183` **#5** | Good intertext lead |
| `yeast`, bridge mode (`W025`) | `status:ok`; H7603/G2219 leaven, H2557, H4682 and Exodus 12 sources readily found | **Resolved prior no-match** |
| `H0120` (`L002`) | Adam–adamah at **#1**; Adam/dam `r12:orth:H0120:H1818` **#11**, labeled orthographic-only | Good, cautious exploratory contrast |
| `G3088` (`L027`) | Lamp→G5459 morning-star/light-bearing `r12:path:G3088:G5459` **#11** with 2 Peter 1:19 endpoint witness | Candidate lexical/symbolic lead, not established intended metaphor |
| `three days resurrection` (`N009`) | Top four results Genesis 7:13, Genesis 30:36, Genesis 40:12–13 **“three days” without resurrection** | **Confirmed remaining multi-concept failure** |

**Negative controls:** I queried `H1904`, `H5869`, `G3056` and `H1285` with 25 results each and inspected **all 25 IDs/titles per input**. None reinstated the earlier false `Hagar→ostrich`, `eye→angel`, `logos→kidney` or `covenant→wheel` endpoint chains. This is a **specific regression PASS**, not proof that all new R12 paths are semantically sound. The current relevant paths are labeled `documented_collocation_or_cooccurrence`, a safer epistemic class than the old false `documented_lexical_relationship`.

### Unseen/complex interpretive probes (not part of the frozen 239)

1. **`Ezekiel 1 living creatures wheels eyes Revelation 4 throne`:** Top positions predominantly Revelation 4 Greek grammatical facts and local pericope overlaps, not a coherent Ezekiel 1 ↔ Revelation 4 *scene correspondence*. No consolidated four-creatures/eyes/wheels/throne evidence path in top 10; some Ezekiel-related partial contacts appear around #20–21. The system finds shared words but does not consistently **align semantic roles and scene structure**.
2. **`Zechariah 4 two olive trees lampstand seven eyes Revelation 11`:** **#1** `r10:xlang:menorah_luchnia` connects Zechariah 4:2 with Revelation 11:4; **#2** retrieves olive-tree/lampstand lexical co-occurrence in Revelation 11:4; `r10:corresp:zech4_menorah_oil_spirit_eyes` at **#11**. These are useful fragments; missing is a structured explanation of how **two trees, oil, lampstand, seven lamps/eyes, the Spirit and the two witnesses** connect, and what each passage explicitly *does and does not* equate.
3. **`Revelation 13 beast sea horns Daniel 7`:** **#1** Daniel 7:7 beast/horns co-occurrence, **#2** Revelation 13:1 beast/horns; direct cross-reference Revelation 13→Daniel 7:2–3 appears **#18** and Daniel 7:7–24 **#23**. It locates texts but cannot explain the compositional relationships: beast origin, horns, kingdoms, power, speech, authority and distinct interpretations.
4. **`unleavened bread crossing of the Red Sea baptism`:** Correct typological `r10:typo:1cor10_1_2_red_sea_baptism` is **#2**; candidate Passover→Red Sea literary pattern `r10:pattern:death_passage_life_passover_redsea` **#4**. But **#1** is an unrelated “unleavened bread” / “Red Sea” pericope in 2 Chronicles 8. Query-focus and pericope precision require work.
5. **`Hagar well spring eyes seeing Genesis 16 Genesis 21`:** Result `r11:intersect:verse:H1904:H5869:386` ranks **#1**, presented as **“hagar” + “well” in Genesis 16:4**. The full English witness reads that Hagar's mistress was despised **“in her eyes”**. The two *lemmas* genuinely co-occur, but the **“well” sense is not used in that verse**. This is a **confirmed sense-label/relevance error**, not a fabricated token.

## 3. Independently verified evidence correctness defects

### P0-A — Hebrew homograph sense is being promoted into incorrect claims

**Repro:** `discover_biblical_connections_v2({query:"Hagar well spring eyes seeing Genesis 16 Genesis 21",limit:25,max_hops:5})` → `r11:intersect:verse:H1904:H5869:386`, then `get_connection_evidence_v1({evidence_id:"r11:intersect:verse:H1904:H5869:386"})`. Real Genesis 16:4 H5869 is “eyes”, not a water source, yet the result title reads “Hagar + well”.

**Why:** The result uses an ambiguous lemma's English gloss as if it were the **attested occurrence sense**. Full original-script occurrence IDs and contextual disambiguation must determine the claim; a general lemma's dictionary sense range is not passage-specific proof.

**Acceptance:** A claim of “Hagar + well” must cite an occurrence that denotes a water source, or explicitly display `SENSE_AMBIGUOUS/NOT_ESTABLISHED`. Genesis 16:4 may still support Hagar+eyes, **never well** on this witness alone.

### P0-B — Semantic translation and name transcription are mislabeled as root derivation

**Repro 1:** Genesis 1:1, `r11:lex:H7225:0`: Hebrew `רֵאשִׁית` (*re'shit*, “beginning”) ↔ Greek `ἀρχή` (*archē*, “beginning”). The card says **“source provided lexical equivalent”**, but the evidence summary says **“Morphological and root derivation analysis links”**, with provenance `derivation_method=lexical_root_derivation` and a shared-origin limitation. These words are semantic/translation equivalents across languages, **not one documented common morphological root**. Its displayed Greek `G0746` has `language:"hbo"` in the discovery original_words payload—also a language-metadata error.

**Repro 2:** `2 Kings 2:14`, `r11:lex:H0452:0`: Hebrew Elijah H0452 ↔ Greek Elias G2243 is titled **“shares root”** and marked `lexical_root_derivation`. This is a **name transcription/identity relation**, not a same-root lexical formation within one language.

**Acceptance:** Typed relations `TRANSLATION_EQUIVALENT`, `PROPER_NAME_EQUIVALENT/TRANSLITERATION`, `SHARES_ETYMOLOGICAL_ROOT`, `SAME_FORM` and `LEXICAL_COGNATE` must be distinct; allow shared roots only with genuine historical morphological evidence, not matching English glosses. Validate source language metadata and release tests for both probes.

### P0-C — Context-specific meaning of base Strong's IDs can be wrong in surfaced word cards

**Repro:** On `Genesis 1:1` the `r11:gram:H1254:grammatical_subject_of:H0430` card has valid Hebrew “God created” witnesses, but the displayed original word candidate is `lemma:H1254c` with gloss **“to be fat / fatten (Hiphil)”** for `בָּרָא` in a **create** context. This risks conflating extended STEP homographs/senses when rendering a canonical occurrence; the grammar relation may remain correct while the **selected explanation/gloss is wrong**.

**Acceptance:** Original-word display must be sourced from the exact passage token and **correct context/extended lemma or sense**, not the first matching base Strong's number. Include Genesis 1:1 as canary with expected “create” meaning and language/sense IDs.

### P0-D — Modern cross-reference source is presented as ancient evidence

**Repro:** `get_connection_evidence_v1({evidence_id:"r11:xref:1832:29274"})` returns true Exodus 12:15 ↔ Galatians 5:12 source text and `source_dataset="CrossReferences.org / OpenBible"`. Its limitation asserts the reference **“documents ancient editorial or intertextual connection.”** A **modern editorial cross-reference** is evidence that contemporary compilers considered the passages related, **not proof of ancient dependency or intended theological correspondence**. These two verses share “cut off” language but concern substantively different contexts.

**Acceptance:** Separate `EDITORIAL_XREF_RECORDED` from `VERIFIED_QUOTATION`, `STRONG_TEXTUAL_ALLUSION`, `SHARED_PHRASE` and `RESEARCH_HYPOTHESIS`. A verified editorial link earns *discovery visibility*, not historical/authorial certainty or high rank for unrelated intent.

### P1-E — Evidence release IDs are easy for AI clients to misuse

The discovery tool's `verification_release.corpus_release` is `r12-discovery-2`, but `get_connection_evidence_v1` expects the **different evidence index release** `r11-v1.0` or omitted release. For a valid R12 ID (`r12:path:G3088:G5459`), `get_connection_evidence_v1({evidence_id,release_id:"r12-discovery-2"})` returns `status:not_found`; omitting `release_id` or using `"r11-v1.0"` succeeds. This is namespace confusion, not disappearance of evidence.

**Acceptance:** Return explicit `evidence_release_id` alongside `corpus_release` in discovery payloads and in generated tool descriptions. Unsupported evidence release should yield `release_not_found` or `release_mismatch`, not an apparent false `evidence_not_found`. Pass the discovery response's **own `release_id`**, not its `verification_release.corpus_release`.

### Verified improvements worth preserving

- `get_connection_evidence_v1("r12:path:G3088:G5459")` reports `score_version:"r12-ranker-v2"`, `endpoint_epistemic_status:"DIRECT_ENDPOINT_WITNESS"` and **2 Peter 1:19** as an actual lamp / morning-star co-occurrence. Maintain the distinction between **direct endpoint witness** and the hypothesized meaning of a 2-hop composite path.
- `get_connection_evidence_v1("r12:prop:G3088:H4501")` labels a derived lamp/menorah oil-property link `external_world_bridge` with `independent_biblical_support=0`, and explicitly says physical similarity does **not** prove a biblical identification. This is appropriately cautious **for the inspected example**; the full physical mapping catalog is not independently audited here.
- `r12:orth:H0120:H1818` is explicitly **orthographic similarity only**, not etymology. Keep this epistemic separation.

## 4. Diagnosis: which subsystem to improve, and why

| Failure mode | Likely responsible subsystem (hypothesis, not source-code-proven root cause) | Evidence | Practical next change |
|---|---|---|---|
| D001, S009 target buried | `discovery_v2` passage-seed candidate prioritization and global rank | Direct witness at #20/#14 behind grammar/LXX | Rank meaningful anchored xrefs/events above unrequested lookup facts; avoid simple hardcoded score increases |
| S001/S006 scene missing | Passage→pericope→event/chronology/typology routing | Red Sea baptism exists in curated data when querying nearer Exodus 14:21, absent from Exodus 14:30 | Event-span index, adjacent scene routing, edition-safe verse spans |
| N009 irrelevant “three days” | Compound query-intent constraints | Results cover “three days” but not “resurrection” | Require governing-concept coverage before claiming a query-supported result |
| Hagar eye→well | Exact occurrence sense selection | Genesis 16:4 says “eyes” | Contextual sense match, with epistemic downgrade if unknown |
| H7225/G0746 lexical root | Edge type + provenance classification and display metadata | Semantic equivalence misrepresented as root derivation; wrong language tag | Reclassify source type, validate extended IDs/language |
| Prophetic scenes fragmented | Structural role graph, passage discourse and cross-book image alignment | Daniel 7/Rev 13 and Ezek 1/Rev 4 individually retrieved without cohesive scene comparison | Graph of typed scene roles, participants, images, source constraints; compare passage blocks |
| R11 xref certainty | Evidence interpretation contract | Modern CrossReferences.org record described as ancient | Separate modern editorial crossref from primary-text citation |
| 503 burst | Worker/gateway reliability (cause unknown) | Q136–Q142 initial HTTP 503, successful retry | Log request IDs, CPU, cache, asset fetch, execution stage, degradations |
| Evidence release not_found | Tool/API version semantics | Corpus release vs evidence release conflated | Explicit separate fields + structured version errors |

The output suggests the **candidate index already knows many useful links**. Therefore, simply adding more data or increasing beam width is not the first solution: make retrieval **passage-grounded and sense-aware**, then rank by *explanatory connection quality*. A fast graph that traverses true edges can still invent a false statement if it conflates senses, unsupported role continuity, different witnesses or provenance classes.

## 5. Prioritized engineering recommendations

### P0 — Correct misleading claims and stabilize production

1. Implement **occurrence-grounded sense verification** for every highlighted term before describing its concept in an individual passage. Reject Hagar+well on Genesis 16:4; preserve the true Hagar+eyes evidence. Extend canaries to ayin eye/spring and polysemous proper names.
2. Correct **relation-type ontology** for semantic equivalence, phonetic name transcription, transliteration, roots, historical cognates and lexical translations; prohibit `lexical_root_derivation` as the generic fallback. Fix incorrect Greek `language=hbo` and `H1254c` sense selection for Genesis 1:1.
3. Make **modern xref** metadata semantically honest. Verified link membership ≠ verified historical intertext. Distinguish textual attestation, literary hypothesis and editorial index provenance.
4. Triage **seven consecutive 503s** from Q136–Q142 using Worker logs rather than guessing CPU overload. Add per-request failure category, stage timings, asset-read counts and graceful partial coverage. Rerun the exact seven affected queries serially, then a controlled sustained workload.
5. Keep R12 endpoint coherence, witness provenance and the four corrected forbidden paths as nonregression requirements.

### P1 — Rebuild ranking around the reader's question

1. Extract an explicit **query plan**: governing topic(s), anchored passages, scenes/events, named entities, required comparands, potential senses and exclusions. Distinguish *all-concepts*, *meaningful-subset*, and *background*; background results must not outrank relevant verified answers merely due to a fixed evidence-tier boost.
2. For passage queries, fetch exact **direct xrefs, narrative events, neighboring pericope roles and scene correspondences** *before* generic word lists. Group routine grammar/LXX into inspectable supporting sections; reserve primary rank positions for candidate discoveries.
3. Rank by **mechanism coherence**: source/target relation, anchor relevance, evidence independence, rare/distinctive shared features, scene-role preservation, discourse context and contradiction checks. Penalize spurious shared common terms and multiple identical witness groups.
4. Introduce a **two-stage architecture**: high-recall retrieval with stable provenance → query-conditioned semantic/mechanistic reranking. Report calibrated scores that do not confuse “graph connected” with “literary connection plausible.”
5. Add **counterfactual rank diagnostics** for D001, S001, S006, S009, S035, N009 and the 13 lost strict targets. Distinguish never-generated, truncated, classified-wrong and generated-but-outscored failures before tuning weights.

### P2 — Deep prophetic and DLM discovery

1. Compile **passage scene signatures** from full verses and syntactic relationships: participant/entity identity, object, action, attribute, number, orientation/location, role, speaker, sequence, negation, and the edition's exact verse span. A shared “eye” or “beast” is not enough.
2. Enable explicit **cross-scene alignments**: Ezekiel 1↔Revelation 4 (living creatures, throne, eyes, wheels); Zechariah 4↔Revelation 11 and Revelation 4–5 (olive trees, oil, witnesses, lampstand, Spirit, seven eyes); Daniel 7↔Revelation 13 (sea, beasts, horns, authority). Record both matching and diverging attributes.
3. Build multi-step **explanation paths**, not just lemma endpoint paths. Each step needs original passage quotation, WEB English, transliteration, phrase/scene role, link type, supporting source and an explicit **direct text / modern xref / interpretive inference / external science** status. Allow users to challenge a proposed link and expand to alternative contexts.
4. Use AI for **hypothesis generation, comparative interpretation and counter-evidence search**, while the MCP verifies occurrence and deterministic relationships. Do not assert a uniquely determined “deep meaning” or DLM-style symbolic correlation from resemblance alone.
5. Widen beyond the **250-anchor pilot** and **64 physical-concept mappings** only after accuracy, source licensing, provenance, and query latency pass fixed tests. Expand genealogy/event identity using verified participants, not name-string joins.

### P3 — Make the benchmark test the actual product goal

Keep all 239 frozen cases and their recorded ranks for comparability, but add **held-out examples** and independent adjudication. Recommended separate metrics:

- **Target@K and paired-anchor@K** (pure retrieval).
- **Verified explanatory mechanism@K** (human/AI adjudicated with full evidence, not automatic keyword match).
- **Intent satisfaction and sense precision** (did the result answer all governing concepts?).
- **False assertion rate** across source provenance, common roots, quotation/allusion, physical-world properties and theological interpretation.
- **Novelty and diversity**: new *meaningful* mechanism families, not just number of paths.
- **Actionable exploration**: full verse text, interpretable transliteration/gloss, evidence step count, alternative interpretations, counterexamples and latency.
- **First-attempt reliability** and graceful-degradation rate, reported separately from retry success.

Benchmark anti-overfit: use frozen cases for tracking, unseen scene/passage pairs for development-independent validation, and hard negatives designed to distinguish **same spelling** from **same sense**, **parallel wording** from **authorial allusion**, and **common motif** from **role-preserving narrative structure**.

## 6. Reproduction commands and acceptance tests

Invoke the connected **read-only** MCP with these inputs (same backend deployment as the saved benchmark):

`discover_biblical_connections_v2({query:"Genesis 1:1",limit:25,max_hops:5})` — must promote source-anchored Genesis 1:1↔John 1:1 above unrelated dough grammar and explain its evidence status.

`discover_biblical_connections_v2({query:"Exodus 14:30",limit:25,max_hops:5})` — must surface Exodus 14 passage-level Red Sea↔1 Corinthians 10 baptism, not require anchoring exact 14:21.

`discover_biblical_connections_v2({query:"2 Kings 2:14",limit:25,max_hops:5})` — Elijah 2:8 repeated water-parting should outrank Genesis flood wind/water correspondence.

`discover_biblical_connections_v2({query:"three days resurrection",limit:25,max_hops:5})` — no top result may be presented as a resurrection connection unless resurrection is actually covered; bare “three days” is insufficient.

`discover_biblical_connections_v2({query:"Hagar well spring eyes seeing Genesis 16 Genesis 21",limit:25,max_hops:5})`, then `get_connection_evidence_v1({evidence_id:"r11:intersect:verse:H1904:H5869:386"})` — Genesis 16:4 must not be labeled as a water-well occurrence.

`get_connection_evidence_v1({evidence_id:"r11:lex:H7225:0"})` and `get_connection_evidence_v1({evidence_id:"r11:lex:H0452:0"})` — assert correct translation/name-equivalence types, not a generic documented common-root derivation.

`get_connection_evidence_v1({evidence_id:"r11:xref:1832:29274"})` — modern editorial xref must not be characterized as ancient source proof.

`discover_biblical_connections_v2({query:"Ezekiel 1 living creatures wheels eyes Revelation 4 throne",limit:25,max_hops:5})` and comparable Zechariah 4/Revelation 11; Revelation 13/Daniel 7 scene probes — require a **coherent passage-to-passage explanation**, not only two isolated co-occurrence cards.

`get_connection_evidence_v1({evidence_id:"r12:path:G3088:G5459",release_id:"r11-v1.0"})` — still retrieves source proof; passing corpus release as the evidence release must return a precise version mismatch.

Repeat negatives `H1904`, `H5869`, `G3056`, `H1285` with `limit:25` and assert the four prior impossible paths do not return. Repeat saved 503 canaries Q136–Q142 without concurrency.

**Pass/fail gate for next release:** No P0 evidence-type or sense-label regression; zero reintroduced negative-control false endpoints; all flagship direct anchor links available within a sensible top-K *without* sacrificing provenance; no unexplained 503 burst; and measurable improvement on **held-out verified mechanism@K**, not just target occurrence.

## 7. Status and limitations

- ✅ GitHub 239-row machine-readable result matrix fetched, parsed and independently aggregated; category and rank figures verified.
- ✅ Live `r12-discovery-2` deployment and worker hash verified.
- ✅ 30 successful live discovery calls spanning 21 input scenarios; 8 unique evidence IDs successfully inspected.
- ✅ Four old false endpoint paths absent from 25 live results each.
- ⚠️ Saved previous full-run **seven initial 503s** remain a real availability regression requiring telemetry. The smaller current test cannot certify it fixed.
- ⚠️ Independent human-level grading of all 215 expected positives and all 24 negative controls was **not performed**. The existing full-run report's semantic conclusions should therefore remain qualified.
- ⚠️ No algorithm code was changed, no benchmark expectations were altered, no destructive Supabase changes or deployment were performed. This is an evaluation and implementation handoff.

**Recommended next implementation order:** **(1) P0 sense/provenance + reliability → (2) question-aware passage/scene ranker → (3) connected prophetic scene reasoning → (4) held-out semantic verification and controlled full 239-case rerun**. Avoid brute-force increasing graph breadth or scoring common dictionary relations until those gates pass.
