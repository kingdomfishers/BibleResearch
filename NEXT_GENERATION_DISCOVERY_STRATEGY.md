# BibleResearch — Next-Generation Discovery Intelligence Strategy (`v3.0`)

> **Author:** Principal Mathematical & Algorithmic Architect (Gemini Carbon)  
> **Target Implementer:** Neon & Delegated Engineering Subagents  
> **Authoritative Workspace:** `C:\Projects\BibleResearch-r10` (`feat/r12-qa-fixes`)  
> **Empirical Grounding:** Neon's [ALGORITHM_AUDIT_AND_ENHANCEMENT_REPORT.md](ALGORITHM_AUDIT_AND_ENHANCEMENT_REPORT.md), ChatGPT Deep Research Audit (`2026-11-25`, `bibleresearch-algorithm-and-dataset-upgrades.md`), 6 Blind Live MCP Research Sessions (`M1`–`M6`), 2 Systems Telemetry Audits (`I1`–`I2`), and 4 Corpus-Scale Prototype Experiments (`E1`–`E4`).  
> **Hard Infrastructure Envelope:** Cloudflare Workers Free (`<= 10 ms` CPU ceiling, **`< 5 ms` target**; `<= 20,000` static assets; `< 25 MiB`/asset; `128 MB` isolate RAM) + Supabase Edge MCP + PostgreSQL; strictly **CC BY 4.0, CC0, MIT, Apache-2.0, Public Domain** redistributed data/code.

---

## 1. Executive Thesis & Fundamental Architectural Insights

### 1.1 Why Current Biblical Discovery Engines Hit a Glass Ceiling

Iterations 1–4 turned BibleResearch into a reliable lexical-and-cross-reference lookup instrument (`MRR = 0.9712` on the 32-case R13 benchmark). Yet when six independent AI researchers (`M1`–`M6`) explored open-ended biblical problems through the live `/mcp` interface without human hints, **every session encountered six fundamental architectural walls**:

1. **Siloed Candidate Cards & Additive Linear Heuristics Instead of Multi-Channel Evidence Convergence:**
   `r10-discovery.ts` generates independent candidate cards (`r11:xref`, `r11:lxx`, `r13:wp`, `r13:motif`, `r12:prop`) and rescores each with heuristic tier offsets (`950..140`) and linear RRF weights (`0.55*E + 0.45*F`, `20*I + 18*N + 15*rrf - 35*U`). When two passages share *four weak, conditionally independent clues*—e.g., a rare 2-word collocation, an LXX translational shift, an inverted clause sequence, and a matching participant-role frame—no mathematical operator accumulates their joint log-likelihood ratio against a null model. Conversely, Experiment `E1` proved that a 4-token verse sharing one medium-frequency noun (`H1817` `דֶּלֶת` "door", `df = 78`) plus its three correlated temple cross-references (`1 Kgs 6:31/34`, `2 Chr 4:22`) concentrates mass and spikes (`42.12`) as a single-axis trap (`Gen 19:10 <-> Ezek 41:23`).
2. **Entity-Only / Undirected Graph Blindness:**
   `multihop-search.ts` walks `10,391` entity-only `r9b` shards blind to verse co-occurrences and passage cross-references, causing `trace_evidence("Exod 17:6" -> "John 7:38")` and `trace_evidence("Gen 28:18" -> "1 Pet 2:5")` (`M6`) to fail with `status: "partial"` even when direct 2-hop bridges (`Ps 118:22`, `Isa 28:16`, `1 Cor 10:4`) sit directly in the corpus. Meanwhile, `subgraph-engine.ts` collapses edge directionality into undirected graphs and hard-drops lemmas with `df > 450`, blinding discovery to crucial theological pivots like `שׂוּם` (`H7760`, `df = 553`) and `מַיִם` (`H4325`, `df = 524`), while letting `df = 65..380` narrative hubs (`שָׁכַם` "rose early", `יָטַב` "be merry", `זָהָב` "gold") hijack `follow_connectionchain` (`M3`, `M5`, `M6`).
3. **A 9-Row MT↔LXX Word-Alignment Table & Missing Tri-Textual (`MT ↔ LXX ↔ NT`) Reasoning:**
   Telemetry (`I2`) revealed that `hebrew_lxx_word_alignments` contains **only `9` rows (`2.6 KB`)**. Runtime fallbacks misaligned `πιστεύων` ("believing") to `מוּסָד` ("foundation") and missed `ἀκρογωνιαῖον -> פִּנַּת` in `Isa 28:16` (`M2`), missed `סִיג (H5509) <-> ἀδόκιμος` (`M3`), failed to detect `Hab 2:4`'s `3ms -> 1cs μου` pronoun shift (`M2`), left Swete OCR corruptions (`ὅρος` for `ὄρος`, `εἷς` for `εἰς`, `τἶδον` for `εἶδον`, missing `Jer 4:25`), mixed Jeremiah transposition keys (`TVTMS:24.31.31->49.38.31` vs `MT-LXX:`; `E2`), carried a restrictive `CC BY-SA 4.0` upstream license on `lxx_swete_words`, and completely lacked `NT <-> LXX <-> MT` 3-way quotation diffing (`M2`, `M5`).
4. **Zero Vocabulary-Independent Scene, Polarity, or Inversion Representation:**
   `compareStructuredRoleFrames` requires exact Strong's ID identity, scoring **`0.0`** (`aligned_roles: []`, `cross_testament_alignment: null`) across `Judges 19 <-> Genesis 19`, `Matthew 4:1-11 <-> Deuteronomy 8:1-5`, and `Deut 6:13-16` (`M5`), while failing (`error`) on `Genesis 1:1-31 <-> Jeremiah 4:23-26` (`M4`) and missing **de-creation / polarity reversal** (`Jer 4:23-26` vs `Gen 1`).
5. **Unfalsified Chiasm Artifacts, Morpheme-Suffix Noise & STEP Pseudo-Homograph Corruption:**
   Uncalibrated sliding-window symmetry detectors hallucinate chiasms on strophic refrains (`Amos 1:3-2:5` centered on Edom, `Psalm 136`, `Genesis 5`; `M4`, `E3`). Wordplay scans emitted `60%` false positives on inflectional endings (`-μος`, `-ιος`, `-ρον`, `מָרוֹת <-> רְתֹם`, `וְהָיָה <-> יְהוָה`) while missing `Matt 16:18` (`Πέτρος <-> πέτρα`), `1 Cor 3:17` (`φθείρει <-> φθερεῖ`), `Phlm 1:10 <-> 20` (`Ὀνήσιμος <-> ὀναίμην`), and `Mic 1:11` (`שָׁפִיר <-> עֶרְיָה־בֹּשֶׁת`) (`M1`, `E4`). Corpus-wide scan (`E4`) also proved that **`1,900 / 2,302` (`82.6%`)** of STEPBible's same-`bs` suffixed `homograph_siblings` are actually grammatical number/state splits (`66.9%`, e.g., `H6697` `"the rock"` vs `"rocks"`) or proper-name leaks (`15.7%`, hijacking `74` base headwords including `H6438` `"Corner (Gate)"`, `H5158` `"palm-tree"`), plus prefix markers (`H2050` in `20,612` verses, `H9002` in `14,416` verses) polluting `all_vids` (`E1`).
6. **Edge Budget Exhaustion & 2× MCP Wire Duplication:**
   `.artifacts-r12/staging-bundle` sits at the exact **`20,000 / 20,000`** Cloudflare Static Assets file limit (`1,241.94 MiB`, with `15,850` obsolete R8/R9b micro-shards; `I1`, `E4`) and uses double gzip decoding (`base64-gz` inside `.json.gz`, reaching `p95 = 41.7 ms`, `max = 117.9 ms` V8 CPU; `E4`). On `/mcp`, `jsonReply` serializes every tool payload **twice** (`content[0].text` AND `structuredContent`), bloating `Judges 19` to **704 KB** (`404 KB` compact) and `literary_structure` across 4 passages to **888 KB** (`M4`, `M5`, `I2`).

---

### 1.2 Mathematical Answers to the Seven Fundamental Questions

| Fundamental Question | Mathematical & Architectural Solution in `v3.0` |
|---|---|
| **1. Recognizing relationships with little shared vocabulary** | Project contextualized tokens `(lemma, morph, MACULA_role)` onto **Cross-Lingual Concept Equivalence Classes (`C_XL`)** (induced offline from symmetric `MT <-> Rahlfs LXX <-> NT` clusters + LLR-gated **OEWN 2025** synsets/L1 hypernyms) and **Process-Mechanism Subgraphs** (`Wikidata` CC0). Align scenes over `(ActantRole, ConceptClass, Polarity)` sequences rather than surface Strong's IDs (`M5`, `E3`). |
| **2. Combining several weak independent clues into a strong discovery** | **Submodular Multi-Axis Log-Bayes Factor (`E_perp(A, B)`):** Group evidence into orthogonal **Semantic/Structural Axes**. Correlated hits within one axis saturate via `log2(1 + sum_{z in a} LR_z)`, while independent axes (`rare_collocation`, `lxx_shift`, `actant_frame`, `sequence_order`, `wordplay_cue`) **add linearly in log-odds bits** above a genre/testament null baseline `mu_0`. |
| **3. Recognizing the same pattern across words, languages, objects, or structures** | **6-Partition Typed Conductance Graph + Piecewise Polarity Sequence Alignment (`SW^piece_pol`)** with `1:2` / `2:1` clause bundling, maintaining strict separation across four epistemic registers: `TEXTUAL_WITNESS`, `LINGUISTIC_GRAMMATICAL`, `STRUCTURAL_RHETORICAL`, and `PHYSICAL_ANALOGICAL`. |
| **4. Discovering meaningful deviations from recurring patterns** | Induce pericope templates over **Idiom-Disambiguated Slots (`SenseID x Stem x GovHead`)**, segment cadence changes via **PELT**, and rank omissions/substitutions/additions by **Dirichlet-Multinomial Predictive Surprisal** `-log2 P(x_{u,s} | x_{-u,s})` (`Amos 2:6-16`, `Gen 1:6-8`, `Gen 1:26`). |
| **5. Separating genuine surprise from statistical coincidence** | Subtract **Marginal + Periodic-Refrain Toeplitz Expectation (`S_tilde`)** prior to anti-diagonal DP, test against **Refrain-Pinned Permutations** + scale-adaptive **MDL**, apply smooth conductance damping `(d_in(u) + 3)^(-0.40)`, multiply single-axis collisions down by axis perplexity `N_eff`, and calibrate output bits with null-model p-values / BH-FDR. |
| **6. Exposing intermediate clues for larger human/AI discoveries** | **Information-Bottleneck Bridge Pivot Ranking (`PivotScore`):** Explicitly surface intermediate verses `v*` maximizing geometric cross-anchor PPR mass `(prod_i p_hat_{A_i}(v*))^(1/m) * ln(1 + N_eff(v*)) * RarityGain(v*)` (e.g., surfacing `Isa 8:14` as the sole `אֶבֶן+צוּר+מִקְדָּשׁ` nexus, or `Gen 18:5` as the `סָעַד+לֵב` hospitality bridge). |
| **7. Achieving depth without overwhelming tokens** | Remove `2x` `jsonReply` duplication (`-50%` wire bytes), select non-redundant clues via **Submodular Marginal-Information Set Cover**, and default all MCP tools to **`view: "clues"` (`2–6 KB`)** with deterministic `expand_id` handles (`"clues" | "evidence" | "full"`). |

---

## 2. Unified Next-Generation Discovery Architecture (`v3.0`)

`v3.0` replaces disconnected batch/runtime scripts with an **interlocking two-plane cascade**: an offline compiler plane obeying strict **CC BY 4.0 / CC0 / MIT / Apache-2.0 / PD** provenance hygiene, and a `< 4.5 ms` edge runtime over consolidated static binary packs (`2,202` total files vs Cloudflare's `20,000` cap).

```text
====================================================================================================
OFFLINE COMPILER PLANE (scripts/build-v3-intelligence.mjs — Zero Runtime CPU, Strict License Gate)
====================================================================================================
 [WLC + morphhb + MACULA Heb/Grk (CC BY 4.0)]   [Open Scriptorium lxx-morph Rahlfs (CC BY 4.0)]
 [STEPBible Lexicon/Tokens (CC BY 4.0)]         [OEWN 2025 (CC BY 4.0) + Curated Wikidata (CC0)]
                        │                                              │
                        ▼                                              ▼
      (A) Canonical Hygiene & Sense Gate               (B) Tri-Textual Alignment Compiler
   • Collapse 1,900 STEP pseudo-homographs          • Rahlfs (primary CC BY 4.0) <-> Swete witness map
   • Purge prefix bugs (H2050/H9002) & 74 hijacks   • Bidirectional EM + Psi(i,j) morpho-syntactic MT<->LXX
   • Skew-Safe LLR-Margin Gate P(s|w,v) -> OEWN/WD  • Extract pronoun/theological/plus LxxShifts
                        │                                              │
                        └──────────────────────┬───────────────────────┘
                                               ▼
                        (C) Concept, Lossless Clause & Graph Compiler
                     • Cross-Lingual ConceptID (C_XL) equivalence clusters
                     • Lossless sequential clause partitioner (100% token/negation cover)
                     • Actant-Event fingerprints (PredConcept, Agent, Patient, Polarity)
                     • Morpheme-Stem + Talion + Onomastic/Valence Wordplay Index (±10v)
                     • Residual SSM S_tilde + Scale-Adaptive Permutation/MDL + Idiom Slots
                                               │
                 ┌─────────────────────────────┼─────────────────────────────┐
                 ▼                             ▼                             ▼
   [index/v3/postings-bmw.bin.gz]  [graph/v3/ppr-top64.pack]     [align/v3/ + rhetoric/v3/]
   • 845+ dense 3,904B bitsets     • 6-partition Typed CSR       • 300k+ MT<->LXX alignments
   • Sparse delta-varint lists     • Conductance beta = 0.40     • Lossless clause/actant packs
   • Block-Max WAND (IDF + NPMI)   • Precomputed Top-64 PPR/node • Pre-scored literary packs
   (1.5 MiB gz | 15 us p50!)       (4.1 MiB gz + 4.2 MiB CSR)    (~17.6 MiB packed | 2,202 total files)

====================================================================================================
ONLINE EDGE WORKER & MCP PLANE (< 4.5 ms Target CPU | Single-Channel Progressive Envelope)
====================================================================================================
   MCP Query / Passage / Anchors
        │
        ├─► 1. Vowel-, Stem- & Sense-Aware Resolver (0.20 ms)
        │
        ├─► 2. Parallel Shortlist Retrieval (0.45 ms)
        │      ├── Binary Hybrid Bitset + Block-Max WAND (exact & relational-rarity intersections)
        │      └── Precomputed Top-64 Typed PPR Merge (multi-hop & cross-testament bridge pivots z*)
        │
        ├─► 3. Submodular Multi-Axis Log-Bayes Scorer E_perp(A, B) (0.75 ms)
        │      └── Saturates single-axis hubs via N_eff; subtracts OT<->NT & length baseline mu_0
        │
        ├─► 4. Top-24 Shortlist Exact Verifiers (1.55 ms)
        │      ├── 3-Way MT<->LXX<->NT Halo Smith-Waterman (witness attribution & composite splices)
        │      ├── Piecewise Polarity Sequence Aligner SW^piece_pol (1:2 / 2:1 clause bundling)
        │      └── Conductance-Weighted Steiner Proof Subgraph (guaranteed connected proof paths)
        │
        └─► 5. Submodular Marginal-Gain Diversifier & Single-Channel Envelope Serializer (0.45 ms)
               └── Emits 2-6 KB `clues` packet + deterministic `expand` handles (zero 2x JSON!)
```

### Cross-Component Complementarity Loops

1. **`MT <-> LXX` Alignment Feeds the Sense Gate (`B -> A`):** Observed LXX renderings in verse `v` (`ὀφθαλμός` vs `πηγή` for `עַיִן` `H5869`; `ἀδόκιμος` for `סִיג` `H5509`) provide strong likelihood ratios inside `Lambda(s_k : s_0 | v)`, preventing polysemous OEWN/Wikidata leakage without trusting corrupted `tok.lk` buckets (`E4`).
2. **Sense Gating + `MT <-> LXX` Enables Vocabulary-Free Sequence Alignment (`A + B -> C`):** When `Deut 8:2-3` and `Matt 4:1-4` share `(ConceptID, Polarity)` signatures rather than Strong's IDs, `SW^piece_pol` with `1:2` clause bundling detects the exact wilderness/forty/test/hunger/bread/utterance sequence (`E3`).
3. **Wordplay & LXX Theological Shifts Enrich the Typed Conductance Graph (`C -> Graph`):** Inflection-cleaned paronomasia (`Πέτρος <-> πέτρα`, `φθείρει <-> φθερεῖ`), onomastic/valence irony (`מָרוֹת <-> טוֹב`, `שָׁפִיר <-> עֶרְיָה־בֹּשֶׁת`), and verified LXX shifts (`H5509 -> G0096`, `H2363 -> G2617`, `H7160 -> G1392`) enter dedicated high-precision CSR partitions (`WP`, `LXX`), allowing multi-hop discovery to bridge concepts across testaments while ignoring suffix noise.
4. **Fast Bitset/BMW + Precomputed PPR Shields Exact Verifiers (`Graph + BMW -> Verifiers`):** Neither 3-Way Halo Smith–Waterman nor `SW^piece_pol` ever touches the full `31,203`-verse corpus online; they execute solely on the `<= 24` shortlisted candidates returned by `postings-bmw.bin.gz` + `ppr-top64.pack`.

---

## 3. Exact Mathematical Formulations & Implementable Pseudocode

### 3.1 Canonical Lexicon Hygiene & Skew-Safe LLR Sense Gate

#### A. Deterministic STEP Pseudo-Homograph & Prefix-Bug Sanitizer
Grounded in `E1` and `E4` corpus-wide measurements across all `19,566` profiles and `2,302` same-`bs` suffixed siblings (`939` Strong's):
1. **Grammatical Prefix Purge (`E1`):** Flag any profile as `is_grammatical_marker = true` if `pos_class in FUNC_POS` or `token_prefix_share(bs) > 0.50` (explicitly catching `H2050` [`tv=20,612`], `H9002` [`14,416`], `H1886` [`14,313`], `H9003` [`12,977`], `H3807` [`11,999`], `H0871` [`10,290`], `H3509` [`6,218`], and `^H90\d{2}$`). Exclude flagged entries from `OCC` graph edges and `BMW` postings. Assign `IDF = 0` to any LXX-only entry with `canonical_df == 0`.
2. **Three-Rule Same-`bs` Pseudo-Homograph Collapse (`E4`):** For every pair `(s1, s2)` sharing base Strong's `B`:
   - **Rule 1 — Proper-Name / Title Segregation (`361 / 2,302 = 15.7%`, fixes `74` hijacked base profiles):** If `isProperOrConstructName(s2)` (e.g., `"Rocks (of Goats)"` on `H6697`, `"Corner (Gate)"` on `H6438`, `"House of Shepherds [Beth-eked]"` on `H7462`, `"Valley of Eshcol/Shittim/Sorek"` on `H5158G..L`) while `s1` is a common lexical noun/verb, segregate `s2` into `B#prop` and promote the highest token-frequency lexical form in `fast-verses` (`141/141` `wadi` for `H5158`, rescuing `H5158` from `"palm-tree"`) as primary headword of `B`.
   - **Rule 2 — Grammatical Inflection / State Collapse (`1,539 / 2,302 = 66.9%`):** If `consonantalSkeleton(s1) == consonantalSkeleton(s2)` and `stemOverlap(cleanGloss(s1), cleanGloss(s2)) > 0`, collapse both into **one unified `SenseID`** (eliminating false `"distinct homograph senses"` alerts like `H6697` `"the rock"` vs `"rocks"` in `M6`).
   - **Rule 3 — Genuine Semantic Homograph Retention (`402 / 2,302 = 17.5%`):** Retain distinct `SenseID`s `s in S(w)` only for true polysemes/homographs (e.g., `H5869` `eye` vs `spring`, `H1253` `lye` vs `H1252` `cleanness`, `H7307` `spirit`/`wind`/`side`) and resolve them per verse via the Skew-Safe LLR Gate below.

#### B. Skew-Safe LLR-Margin Sense Gate (`P(s | w, v)`)
`E4` proved that unweighted Naive Bayes under `43:1` class skew (`H5869`: `868` eye vs `20` spring) generates `57` false `eye -> spring` flips, and STEP's `tok.lk` tag `lemma:H5869M` conflates both senses. Therefore, external ontology edges (`OEWN 2025`, `Wikidata`) attach only to verified per-verse `SenseID`s passing a **prior-skew-calibrated Log-Likelihood Ratio plus safety margin `gamma_min = 3.0` bits**:

$$\Lambda(s_k : s_0 \mid v) = \log_2 \frac{P(g_{\text{LXX}}(w,v) \mid s_k)}{P(g_{\text{LXX}}(w,v) \mid s_0)} + \log_2 \frac{P(r_{\text{MACULA}}(w,v), h_{\text{gov}}(w,v) \mid s_k)}{P(r_{\text{MACULA}}(w,v), h_{\text{gov}}(w,v) \mid s_0)} + \sum_{u \in \text{ctx}(v)\setminus\{w\}} \operatorname{clamp}_{[-2,\,2]}\!\left(\log_2 \frac{P(u \mid s_k)}{P(u \mid s_0)}\right)$$

$$\hat{s}(w, v) = \begin{cases} s_k & \text{if } \Lambda(s_k : s_0 \mid v) > \log_2 \dfrac{\pi(s_0)}{\pi(s_k)} + \gamma_{\min} \quad (\gamma_{\min} = 3.0\text{ bits}) \\ s_0 & \text{if } \max_{k > 0} \Lambda(s_k : s_0 \mid v) < -\gamma_{\min} \\ \texttt{AMBIGUOUS} & \text{otherwise (keep textual Strong's; abstain from OEWN/Wikidata edges!)} \end{cases}$$

---

### 3.2 Tri-Textual Witness Engine (`MT ↔ Rahlfs/Swete LXX ↔ SBLGNT`)

#### A. Clean-Room CC BY 4.0 LXX Spine & Canonical Versification Keying
- **Primary Redistributed LXX Spine:** Ingest **Open Scriptorium `lxx-morph`** (**CC BY 4.0** per-book JSON across 59 Rahlfs 1935 books, writing clean native TypeScript code — never copy `ISC` pipeline scripts; reject `CATSS`, `CenterBLC`, and `NuBerea` due to upstream `CC BY-NC` / noncommercial constraints). Combine with `Open Scriptorium db/seeds/mt_alignment/verse_pairs.jsonl` and `bcv-lxx-bridge` (**CC BY 4.0**), indexed strictly by **`canonical_verse_id`** (solving `E2`'s `TVTMS:24.31.31->49.38.31` Jeremiah transposition bug, untitled Psalm shifts, Exodus 35–40 tabernacle reordering, and CATSS error-catalog regression tests).
- **Diplomatic Swete Witness Layer:** Align existing `lxx_swete_words` (**CC BY-SA 4.0**) per verse group against Rahlfs tokens via monotonic Greek Needleman–Wunsch using `normalizeSweteToken` (fixing drop-caps `τἶδον -> εἶδον`, `χἶδον -> εἶδον`, breathing errors `ὅρος -> ὄρος`, `εἷς + Acc -> εἰς`, `οὔ -> οὐ`, restoring `Jer 4:25`). Store core v3 static shards solely from CC BY 4.0 Rahlfs data, exposing Swete only as an isolated variant witness tag where Swete differs from Rahlfs.

#### B. Morpho-Syntactic Posterior `MT ↔ LXX` Aligner (`Psi(i, j)`)
Offline (`Stage S1`), run 5 iterations of bidirectional IBM Model 2 / `fast_align` EM over all `(MT, Rahlfs)` verse pairs with `(heb_lemma, grk_lemma)` + `(heb_root, grk_stem)` backoff (handling preverb/compound derivations like `פִּנָּה -> ἀκρο-γωνιαῖος` and `קָרָא -> μετα-καλέω`). Then evaluate the joint posterior compatibility matrix for MT content token `h_i` and Rahlfs token `g_j`:

$$\Psi(i, j) = \log_2 \frac{P_{\text{fwd}}(g_j \mid h_i)\,P_{\text{rev}}(h_i \mid g_j)}{P_0(g_j)\,P_0(h_i)} + \lambda_{\text{pos}}\Phi_{\text{POS}}(h_i, g_j) + \lambda_{\text{feat}}\Phi_{\text{pers/num}}(h_i, g_j) + \lambda_{\text{role}}\Phi_{\text{MACULA}}(h_i, g_j) - \lambda_{\text{dist}}\frac{|i/m - j/n|}{\sigma_{\text{book}}}$$

with calibrated weights `lambda_pos = 3.0`, `lambda_feat = 1.5`, `lambda_role = 2.0`, `lambda_dist = 0.6`, and translator literalness spread `sigma_book in [0.15, 0.45]`. Decode in two passes (`anchor >= 4.0`, then clause-bounded bipartite match `>= 1.2`). Automatically emit typed `LxxTranslationShift` records:
1. **`pronoun_person_shift`:** Aligned `(h_i, g_j)` (+ clitic `μου/σου/αὐτοῦ/ἡμῶν` within `[j, j+2]`) where Hebrew pronominal suffix person/number diverges from Greek (`Hab 2:4`: `נַפְשׁוֹ [3ms] -> ψυχή μου [1cs]`, `בֶּאֱמוּנָתוֹ [3ms] -> πίστεώς μου [1cs]`).
2. **`lexical_theological_shift`:** Aligned content pair with conditional translation share `P(g_j | h_i) < 0.08` and specificity `IDF(g_j) >= 3.5` (`Isa 28:16` `חוּשׁ -> καταισχύνω`; `Isa 1:22` `סִיג -> ἀδόκιμος`; `Exod 34:29` `קָרַן -> δοξάζω`; `Jer 31:32` `בָּעַל -> ἀμελέω`).
3. **`lxx_plus_expansion` / `mt_minus`:** Contiguous unaligned content span with `content_len >= 2` or `sum IDF >= 5.0` (`Isa 40:5` `+ τὸ σωτήριον τοῦ θεοῦ`).

#### C. Online 3-Way `MT ↔ LXX ↔ NT` Halo Smith–Waterman (`alignTriTextualQuote`)

```typescript
// Validated in E2: 38/38 (100%) gold token witness attribution, 2/2 splices, 2/2 negative rejections
type WitnessClass =
  | 'agrees_both'
  | 'agrees_lxx_against_mt'
  | 'agrees_mt_against_lxx'
  | 'composite_splice'
  | 'nt_adaptation';

interface TriAlignedToken {
  nt_idx: number;
  nt_surface: string;
  nt_lemma: string;
  lxx_idx: number | null;
  mt_idx: number | null;
  witness: WitnessClass;
  divergence_ref?: string;
}

function alignTriTextualQuote(
  ntTokens: NtToken[],
  candidates: OtLxxCandidateGroup[], // top <= 16 OT candidates from LXX-lemma + ConceptID BMW shortlist
): TriTextualResult | null {
  const hits: LocalSwHit[] = [];
  for (const cand of candidates) {
    // Smith-Waterman substitution score S[r][c] for NT token r vs (LXX token c, MT token h = cand.lxxToMt[c]):
    //   Exact Greek lemma (nt.lemma == lxx.lemma):                +IDF(lxx.lemma)
    //   Greek stem/tense/voice variant (e.g. καταισχυνθῇ/σεται): +0.85 * IDF(lxx.lemma)
    //   MT-against-LXX match (nt.lemma in mt.equivs && != lxx):   +0.90 * IDF(nt.lemma)
    //   Function word / pronoun agreement:                        +0.60
    //   Gap open = -1.10, Gap extend = -0.55
    const peaks = extractNonOverlappingSmithWatermanPeaks(ntTokens, cand, {
      minScore: 5.5,
      minContentMatches: 2,
      minIdfSum: 4.0,
    });
    for (const peak of peaks) {
      // ±3-token adaptation halo (captures 'Ἰδοὺ τίθημι' ahead of 'ἐν Σιὼν λίθον' in Rom 9:33 & 1 Pet 2:6!)
      hits.push(expandAdaptationHalo(ntTokens, cand, peak, 3));
    }
  }
  if (hits.length === 0) return null;

  const selected = resolveMultiSourceSplices(hits); // e.g., Isa 28:16 + Ps 118:22 + Isa 8:14 in 1 Pet 2:6-8
  const tokens: TriAlignedToken[] = classifyEachNtToken(ntTokens, selected);
  // Attribution decision tree inside accepted spans:
  //   1. Match LXX[c] AND regular MT[h] mapping (no divergence flag)   => 'agrees_both'
  //   2. Match LXX[c] AND LXX[c] carries LxxTranslationShift flag       => 'agrees_lxx_against_mt'
  //   3. Diverge from LXX[c] BUT match MT[h] lexical equivalents        => 'agrees_mt_against_lxx' (e.g. σκανδάλου)
  //   4. Boundary crossing within <= 25 NT tokens to distinct OT source => 'composite_splice'
  //   5. Halo/local lexical or grammatical change within span           => 'nt_adaptation' (e.g. Εὐθύνατε, τίθημι)
  return { sources: selected.map(s => s.ref), splices: detectSplices(selected), tokens };
}
```

---

### 3.3 Six-Partition Typed Conductance Graph, Precomputed Top-64 PPR & Submodular Multi-Axis Log-Bayes Scorer

#### A. Node Space & Conductance-Damped Transition Operator
Over node universe `V` (`N ~ 53,500` `uint32` IDs: `0..31,202` Canonical Verses; `31,203..~50,200` sanitized `SenseID`s; `~50,201..~53,500` `ConceptID` + `ProcessMechanism` nodes), build **6 typed directed CSR partitions**:
$$\tau \in \{\texttt{OCC},\ \texttt{XREF},\ \texttt{LXX},\ \texttt{LEX\_SYN},\ \texttt{WP},\ \texttt{CONCEPT\_PROC}\}$$
For each source node `v` and active outgoing partition `tau in T(v)`, probability mass is partitioned explicitly across relation families (`sum_{tau} rho_tau(v) = 1`, e.g., from a `SenseID`: `rho_OCC = 0.40`, `rho_LXX = 0.28`, `rho_LEX_SYN = 0.18`, `rho_WP = 0.08`, `rho_CONCEPT_PROC = 0.06`, guaranteeing `EXTERNAL_WORLD` stays bounded `<= 0.06` and never inflates textual witness counts):

$$P_\tau(v \to u) = \rho_\tau(v) \cdot \frac{w_\tau(v, u) \cdot \big(d_\tau^{\text{in}}(u) + \kappa_\tau\big)^{-\beta}}{\sum_{x \in N_\tau(v)} w_\tau(v, x) \cdot \big(d_\tau^{\text{in}}(x) + \kappa_\tau\big)^{-\beta}}, \qquad \beta = 0.40,\ \kappa_\tau = 3$$

**Calibration Rationale (`E1`):** `beta = 0.0` leaks into function words (`G0846 df=3710`, `G2532 df=5132`); `beta = 0.70` with unsmoothed degree over-spikes `df = 1` hapaxes (`G4482`); smoothed `(d_in(u) + 3)^(-0.40)` inside `E1`'s optimal `0.35–0.50` band retains `H7760` (`df = 553`) and `H4325` (`df = 524`), eliminates hub leaks, and stabilizes `df = 1` nodes.

#### B. Offline Top-64 Quantized PPR Vectors (`< 0.15 ms` Online)
Because `E1` measured `15.1–24.4 ms` for online `localPush` (`alpha = 0.20, eps = 1e-4`), **run typed local push offline** (`eps = 2e-5`) from every non-verse node `w in SenseID union ConceptID` (`~22,300` seeds), storing the **Top-64 `(targetNodeId: uint32, logProbQ16: uint16, metapathMask: uint8)`** entries (`22,300 * 64 * 7 B ~ 9.99 MiB` raw, `~4.1 MiB` packed/gzipped). At runtime, reconstruct any passage's typed distribution `p_hat_A` in `< 120 us`:

$$\hat{p}_A(z) = \alpha\,\mathbb{I}[z \in A] + (1 - \alpha)\sum_{w \in A_{\text{content}}} \tilde{\pi}_A(w)\cdot \text{PPR}_{\text{top64}}(w)[z] + \eta_{\text{xref}}\sum_{u \in \text{Xref}(A)} w_{\text{xref}}(A, u)\,\mathbb{I}[z = u]$$

where $\tilde{\pi}_A(w) = \text{IDF}(w) / \sum_{w' \in A_{\text{content}}} \text{IDF}(w')$.

#### C. Submodular Multi-Axis Log-Bayes Convergence & Pivot-Clue Extraction (`E_perp`)
To eliminate `E1`'s two failure modes (`NEG6` `H1817 דֶּלֶת` single-axis mass explosion in 4-token `Ezek 41:23`, and `POS1` `-1.9` cross-testament hop attenuation), map every bridging node `z` to its **Canonical Concept Axis** `a(z) in A` (e.g., `H0068`, `G3037`, and `Stone`-XREFs collapse into `AXIS:STONE`; `H7760 <-> G5087` into `AXIS:SET_LAY`; `H6438 <-> G0204` into `AXIS:CORNER`):

1. **Within-Axis Log-Saturation + Cross-Testament Baseline Normalization:**
   $$s_a(A, B) = \log_2\!\left(1 + \sum_{z : a(z) = a} \frac{\hat{p}_A(z)\,\hat{p}_B(z)}{P_0(z \mid \mathcal{T}_A, \mathcal{T}_B)}\right)$$
   where $P_0(z \mid \text{OT}, \text{NT}) = 0.28\,P_0(z \mid \text{same})$ reflects expected cross-testament attenuation via the `LXX` partition.
2. **Axis-Entropy (`N_eff`) Multiplicative Single-Axis Damper:** With $q_a = s_a / \sum_{a'} s_{a'}$ and Shannon axis perplexity $N_{\text{eff}}(A, B) = \exp\!\left(-\sum_a q_a \ln q_a\right)$:
   $$\mathcal{E}_{\perp}(A, B) = \left(\sum_{a \in \mathcal{A}_{\text{textual}}} s_a(A, B) + \Delta_{\text{seq}}(A, B) + \Delta_{\text{3way}}(A, B)\right) \cdot \min\!\left(1.0,\ \frac{N_{\text{eff}}(A, B) - 0.65}{1.35}\right) - \log_2\!\big(1 + c_{\text{len}}\sqrt{|A|\cdot|B|}\big)$$
   When `NEG6` (`Gen 19:10 <-> Ezek 41:23`) derives `100%` of its mass from `AXIS:DOOR`, `N_eff = 1.00`, reducing its score by `(1.00 - 0.65)/1.35 = 0.259x` (`-74%`), while logarithmic saturation suppresses its redundant temple cross-references; conversely, `POS1` (`Gen 28:18 <-> 1 Pet 2:5-6`) spans 4+ axes (`N_eff >= 3.5 -> multiplier = 1.0`). External physical-property axes `A_phys` are scored separately and capped (`<= 0.15 * E_perp_textual`) so ungrounded analogies never dominate textual convergence.
3. **Information-Bottleneck Bridge Pivot Score (`M6`, `M5`):** Rank candidate intermediate verses `v*` across anchors `A_1..A_m` by:
   $$\text{PivotScore}(v^*) = \left(\prod_{i=1}^{m} \hat{p}_{A_i}(v^*)\right)^{1/m} \cdot \ln\!\big(1 + N_{\text{eff}}(v^*)\big) \cdot \text{RarityGain}(v^*)$$

---

### 3.4 Lossless Clause Partitioner & Piecewise Polarity Sequence Aligner (`SW^piece_pol`)

`E3` exposed that packed `literary_clauses` dropped negations (`οὐκ` in `Matt 4:4`), `Deut 8:2` bundles 4 concepts into 1 Hebrew clause where `Matt 4:1-2` splits them across 3 Greek clauses, and `Jer 4:23-26 <-> Gen 1` uses **mixed forward/reversed clause blocks with `POS <-> NEG` polarity inversions**.

1. **Lossless Sequential Clause Partitioner:** Exhaustively cover `100%` of verse tokens along MACULA clause heads, recording `(concepts: ConceptId[], roles: ActantRole[], polarity: 'POS' | 'NEG')`, setting `'NEG'` on `לֹא / אֵין / אַל / בְּלִי / בִּלְתִּי / טֶרֶם / οὐ / οὐκ / οὐχ / μή / οὐδείς / μηδείς / χωρίς / ἄνευ` or verified `ἀ-` privatives.
2. **Signed Concept-Role Similarity:**
   $$\sigma_{\text{same}}(U, V) = \mathbb{I}[\text{pol}(U) = \text{pol}(V)] \cdot \text{RoleConceptSim}(U, V), \qquad \sigma_{\text{inv}}(U, V) = \mathbb{I}[\text{pol}(U) \neq \text{pol}(V) \lor \text{Antonym}(U, V)] \cdot \text{RoleConceptSim}(U, V)$$

```typescript
// Implements 1:1, 1:2, and 2:1 clause bundling + piecewise monotonic/reversed block extraction (E3 insight)
function alignClauseSequencesPiecewise(clausesA: ClauseSig[], clausesB: ClauseSig[]): SequenceAlignment {
  // Gotoh DP transitions at (i, j):
  //   1:1 match: (i-1, j-1) + score(clausesA[i], clausesB[j])
  //   1:2 bundle: (i-1, j-2) + score(clausesA[i], union(clausesB[j-1..j])) - 0.15  // catches Deut 8:2 <-> Matt 4:1-2
  //   2:1 bundle: (i-2, j-1) + score(union(clausesA[i-1..i]), clausesB[j]) - 0.15
  // Run across BOTH orientations (B forward and B reversed) and BOTH polarity modes ('CONCORDANT' vs 'INVERSION'):
  const fwd = runBundledGotohDP(clausesA, clausesB);
  const rev = runBundledGotohDP(clausesA, [...clausesB].reverse());

  // Greedily extract non-overlapping local blocks (switching fwd <-> rev costs switchPenalty = 1.8)
  // Handles Gen 19 <-> Judg 19 (pure forward: 19 clauses, p=0.005) AND Gen 1 <-> Jer 4:23-26 (mixed-order + polarity flip)
  const blocks = assemblePiecewiseBlocks(fwd.blocks, rev.blocks, { switchPenalty: 1.8 });
  const rawScore = blocks.reduce((acc, b) => acc + b.score, 0);
  const pNull = estimateSequenceNullPValue(clausesA, clausesB, rawScore, 64);

  return {
    raw_score: rawScore,
    p_null: pNull,
    evidence_bits: pNull < 0.05 ? Math.min(12.0, -Math.log2(Math.max(pNull, 1e-4))) : 0,
    arc_kind: classifyArcKind(blocks), // 'parallel_scene' | 'mirror_inversion' | 'antithetical_decreation' | 'piecewise_mixed'
    blocks,
  };
}
```

---

### 3.5 Residual SSM (`S_tilde`), Scale-Adaptive Chiasm Significance & Idiom-Slot Surprisal

#### A. False-Positive-Free Chiasm Detector (`0/3` Hard FPs, `4/4` True Chiasms in `E3`)
Construct pairwise similarity $S_{ij} \in [0, 1]$ over units (tokens for `N <= 36`, lossless clauses for `12 <= N <= 80`, verses for `N > 40`), restricting consonantal/root matches to **>= 3 root consonants** + exact Strong's/ConceptID/Role match (eliminating `E3`'s 2-consonant `לב`/`שמ` false collisions in `Isa 6:10`):

1. **Doubly-Centered + Periodic/Forward-Diagonal Refrain Subtraction:**
   $$C_{ij} = S_{ij} - \hat{\mu}_i - \hat{\mu}_j + \hat{\mu}, \qquad \hat{R}^{\text{periodic}}_{ij} = \max\!\left(0,\ \frac{1}{N - |i - j|}\sum_{t=1}^{N-|i-j|} C_{t,\,t+|i-j|}\right), \qquad \tilde{S}_{ij} = \max\!\big(0,\ C_{ij} - \hat{R}^{\text{periodic}}_{ij}\big)$$
2. **Gapped Anti-Diagonal DP & Scale-Adaptive Significance Gate (`E3` Discovery):**
   Compute $D_{i,j} = \max\!\left(0,\ \tilde{S}_{i,j} + \max_{\delta_1,\delta_2 \in \{1,2\}}\!\big(D_{i-\delta_1,\,j+\delta_2} - \gamma_{\text{gap}}(\delta_1 + \delta_2 - 2)\big)\right)$ (`i < j`).
   Run `B = 200` **Refrain-Pinned Permutations** (freezing structural refrain clusters with `freq >= max(4, ceil(0.2*N))` and permuting non-refrain units):
   - **Short Windows (`N <= 15`, e.g. `Gen 9:6`, `Gen 1:27`, `Isa 6:10`):** Accept iff `p_dp <= 0.03` AND `aligned_pairs >= 3` (avoids two-part MDL pointer header `log2(N*(N-1)/2) = 5.5–6.7 bits` over-penalizing single-verse chiasms).
   - **Extended Pericopes (`N > 15`, e.g. `Amos 5:4-6` vs `Amos 1:3-2:5`, `Ps 136`, `Gen 5`):** Require **BOTH** `p_dp <= 0.03` **AND** Two-Part MDL compression gain $\Delta L = L_0 - \big(L(M) + L(D \mid M)\big) > 0\text{ bits}$.

#### B. Idiom-Disambiguated Template Slots & Dirichlet-Multinomial Surprisal
- Represent each recurring template slot atom by **`SlotAtom = (SenseID, VerbStem, GovObjectOrVerbClass)`** (eliminating `M4`'s false `reordering` on `Amos 1:7` `H7725` `אֲשִׁיבֶנּוּ` vs `הֲשִׁיבוֹתִי יָדִי` and `Ps 136:1` `כִּי טוֹב` falsely matching `Gen 1`'s `וַיַּרְא ... כִּי־טוֹב`).
- Score anomalies per unit `u` across `M` parallel units via leave-one-out Dirichlet-Multinomial surprisal (`alpha = 0.25`):
  $$\text{SurprisalBits}(u, s) = -\log_2 \frac{\text{count}_{-u}(x_{u,s}) + 0.25}{M - 1 + 0.25\,|\mathcal{V}_s|}$$
  combined with PELT piecewise-cost changepoint detection (Killick et al. 2012, `O(N)` expected time) for speaker/formula transitions (`Amos 2:16` `נְאֻם־יְהוָה` shift, `Gen 1:26` `1cp` `נַעֲשֶׂה`).

---

### 3.6 Morpheme-Stem, Syntactic Talion & `±10v` Onomastic/Valence Wordplay (`0%` FP in `E4`)

1. **POS-Aware Stemmer & Lemma-Guarded Proclitic Stripper:** Strip Greek inflectional endings (`-ος/-ον/-ου/-ῳ/-οις/-ας/-ης/-ων/-ειν/-εις/-σαν/-θην`) using known `tagnt`/Rahlfs POS tags (`Πέτρ-ος` / `πέτρ-ᾳ -> πετρ`, `lcs = 4`), and strip Hebrew proclitics (`ו/ב/כ/ל/מ/ה/שׁ`) **only** when absent from `lemma_script` (preserving nominal `מ-` in `מִשְׁפָּט <-> מִשְׂפָּח`, `Isa 5:7`). Require `>= 3` shared non-mater consonants or `>= 3`-consonant metathesis (rejecting `δεσμοῖς <-> Ὀνήσιμον`, `φρονεῖν <-> μέτρον`, `מָרוֹת <-> רְתֹם`, `וְהָיָה <-> יְהוָה`).
2. **Syntactic Talion & Clause Polyptoton:** Detect same-lemma pairs across adjacent condition/consequence or active/passive clauses where tense/voice/case or MACULA `Agent <-> Patient` role flips (`1 Cor 3:17` `φθείρει <-> φθερεῖ`; `Matt 21:41` `κακοὺς κακῶς`; `Gen 9:6` `שֹׁפֵךְ <-> יִשָּׁפֵךְ`).
3. **Onomastic Etymological & Evaluative Valence Play (`±10` verses):** Map proper nouns to their OSHB/STEP etymological glosses (`lexical_senses`) + OEWN 2025 1–2 hop synonyms/antonyms AND precomputed **Evaluative Valence (`+1` vs `-1`)** over OEWN adjectives/states—recovering both `Phlm 1:10-20` (`Ὀνήσιμος` ↔ `ἄχρηστος` / `εὔχρηστος` / `ὀναίμην`), `Mic 1:12` (`מָרוֹת` "bitterness" ↔ `טוֹב`), and `Mic 1:11` (`שָׁפִיר` "fair/beautiful", `+1` ↔ `עֶרְיָה־בֹּשֶׁת` "nakedness-shame", `-1`, closing `E4`'s remaining edge case).

---

## 4. Disposition Matrix of Existing Algorithms & Modules

| Module / Asset | Disposition | Concrete Architectural Action |
|---|---|---|
| `src/relationships/wordplay-engine.ts` (`Algorithm A`) | **EXTEND** | Keep phonetic classes, matres stripping, & biblical cues (`H4100+H7200`, etiologies); add POS-aware Greek/Hebrew stem stripper, syntactic talion, and `±10v` Onomastic/Valence play. |
| `src/relationships/motif-discovery.ts` (`Algorithm B`) | **COMBINE** | Keep offline NPMI collocation mining (`npmi >= 0.08`); inject top-pair NPMI directly into `postings-bmw.bin` block upper bounds; retire slow runtime `beamSearchMotifPaths`. |
| `src/relationships/symbolic-patterns.ts` (`Algorithm C`) | **EXTEND** | Preserve strict `826` self-interpretation table; replace Strong's-only `compareStructuredRoleFrames` with `ConceptID` + `SW^piece_pol` (`1:2`/`2:1` bundling), fixing `score = 0` (`M5`). |
| `src/relationships/evidence-synthesis.ts` (`Algos D & E`) | **EXTEND** | Keep evidence stratification; drive cross-testament matching from offline `MT <-> Rahlfs` `Psi(i,j)` alignments + online Top-24 `alignTriTextualQuote`. |
| `src/relationships/tesserae-retrieval.ts` | **PRESERVE & RE-HOST** | Keep MIT-safe relational rarity (`IDF + gamma*NPMI`) & RRF; execute candidate generation over `postings-bmw.bin` instead of `fast-verses` `base64-gz` decoding. |
| `src/relationships/subgraph-engine.ts` | **COMBINE** | Retain KMB Steiner tree + cycle closure as the **explanation tracer**, running over the **Top-128 Typed Conductance PPR subgraph** instead of `df <= 450` undirected BFS. |
| `src/relationships/multihop-search.ts` & `adjacency-loader.ts` | **REPLACE** | Entity-only `10,391` `r9b` micro-shards cause `trace_evidence` dead ends (`M6`). Replace with unified `v3/graph/ppr-top64.pack` + `typed-csr.bin.gz` Steiner tracer. |
| `src/relationships/r10-discovery.ts` (`6,913` L) | **REPLACE SCORER** | Keep query normalization & epistemic guardrails; replace linear 7-factor scorer with **Submodular Multi-Axis Log-Bayes (`E_perp`)** + Submodular Diversifier. |
| `src/relationships/literary-engine.ts` | **EXTEND** | Keep segmentation, acrostics, & browser/Worker/MCP sync; upgrade `discoverChiasms` to Residual SSM `S_tilde` + Refrain-Pinned Perm/MDL, upgrade slots to Idiom Atoms, add lossless clauses & `v3/align/mt-lxx`. |
| `literary-hebrew.mjs`, `literary-hebrew-alignment.mjs`, `PassageDiscoveryStrip.ts` | **RETIRE** | `0` production callers (`ALGORITHM_AUDIT_AND_ENHANCEMENT_REPORT.md` §2). |
| `staging-bundle/v2/relationships/{r8-*,r9b-*}` (`15,850` files) | **RETIRE & PACK** | Redundant legacy micro-shards pinning bundle at `20,000/20,000` (`I1`, `E4`). Retire and pack active indexes into `~2,202` total files. |
| `supabase/functions/bible-mcp/` `jsonReply` | **FIX IMMEDIATELY** | Stop emitting duplicate `structuredContent` alongside `content[0].text` (`I2`), cutting wire/token bytes by `~50%`. |

---

## 5. New Data Structures, Binary Schemas & Edge Budget Verification

### 5.1 Binary Hybrid Bitset + Block-Max WAND Index (`v3/index/postings-bmw.bin`)

Validated in `E4` (`19,566` current lemmas = `4.31 MiB` raw / `828.3 KiB` gzipped, **`p50 = 15.0 us`**, **`p95 = 270.8 us`**, **`max = 0.37 ms`**, **`50.9%`** block skip, **`100%`** Top-32 exact score parity). Extending the directory to also index **Rahlfs LXX Greek lemmas (`~9,400`)**, **`ConceptID`s (`~2,800`)**, and **Actant-Frame Fingerprints** fits cleanly in one pre-warmed **`7.1 MiB` raw / `1.5 MiB` gzipped** isolate binary:

```text
File Header (64 bytes, little-endian):
  magic: "BRV3BMW\0" (8B) | version: u32 (3) | num_verses: u32 (31203) | num_blocks: u32 (488)
  num_terms: u32 (~31800) | dir_offset: u32 | dense_offset: u32 | sparse_offset: u32 | bmw_offset: u32

Term Directory Entry (20 bytes/term, sorted by key_hash64 for O(log N) lookup):
  key_hash64: u64 | df: u16 | flags: u8 (bit0=dense, bit1=func_stop, bit2=lxx, bit3=concept, bit4=actant)
  idf_q8: u8 | payload_offset: u32 | bmw_offset: u32

Dense Bitset Payload (df >= 64 -> fixed 3,904 bytes = Uint32Array[976]):
  Hardware-friendly bitwise AND / OR / ANDNOT with zero heap allocations (< 4 us per operation).

Sparse Posting Payload (df < 64 -> delta-varint Uint8Array, mean 11.4 bytes/term):
  Stream-decoded into a reusable scratch Int32Array[64].

Block-Max WAND Upper-Bound Array (4 bytes per active 64-verse block):
  block_id: u16 | ub_lexical_q8: u8 (max IDF in block) | ub_relational_q8: u8 (max pair NPMI bonus)
```

```typescript
// Allocation-Free Block-Max WAND Kernel (< 0.35 ms p99 across 3-6 term queries in V8)
function blockMaxWandTopK(cursors: TermCursor[], k = 32, minTheta = 3.5): ScoredBlock[] {
  const heap = new MinHeap<ScoredBlock>(k);
  let theta = minTheta;
  while (advanceCursorsToPivot(cursors, theta)) {
    const b = cursors[0].curBlock;
    if (leadingCursorsAlignedAt(cursors, b)) {
      evaluateExactBlock(b, cursors, heap, theta); // uses dense Uint32Array[block*2..block*2+1] directly
      theta = heap.isFull() ? heap.minScore() : minTheta;
      advanceAlignedPast(cursors, b + 1);
    } else {
      skipPivotBlock(cursors);
    }
  }
  return heap.toSortedDesc();
}
```

### 5.2 Complete Static Bundle & Worker CPU Verification

| Asset Family (`staging-bundle/`) | File Count | Raw Size | Deployed / Gzipped Size | Max File |
|---|---:|---:|---:|---:|
| `v3/index/postings-bmw.bin.gz` (HB+NT+LXX+Concept+Actant) | `1` | `7.1 MiB` | `1.5 MiB` | `1.5 MiB` |
| `v3/graph/ppr-top64.pack` (`16` binary packs + `index.json`) | `17` | `11.8 MiB` | `4.1 MiB` | `0.35 MiB` |
| `v3/graph/typed-csr.bin.gz` (for Steiner proof tracing) | `1` | `12.8 MiB` | `4.2 MiB` | `4.2 MiB` |
| `v3/profiles/pack-00..31.bin` (flat profiles, zero nested `b64-gz`) | `33` | `94.0 MiB` | `28.5 MiB` | `1.1 MiB` |
| `v3/verses/pack-00..63.bin` (lossless clauses + Rahlfs/MT refs) | `65` | `142.0 MiB` | `46.0 MiB` | `0.95 MiB` |
| `v3/align/mt-lxx-00..31.bin` (`300k+` posterior links + shifts) | `33` | `29.0 MiB` | `8.4 MiB` | `0.40 MiB` |
| `v3/rhetoric/structure-wordplay-00..31.bin` (chiasm/slots/wordplay) | `33` | `31.0 MiB` | `9.2 MiB` | `0.45 MiB` |
| Retained `v1/` + `tables/` (UI/legacy compatibility) | `2,019` | `513.9 MiB` | `513.9 MiB` | `3.30 MiB` |
| **TOTAL DEPLOYED CORPUS BUNDLE** | **`2,202` (`<= 20,000`)** | — | **`~615.8 MiB` (`-50.4%`)** | **`4.2 MiB` (`< 25 MiB`)** |

**Worker Request CPU Budget:** Query Normalization (`0.20 ms`) + Hybrid Bitset/BMW (`0.30 ms`) + Precomputed Top-64 PPR Merge (`0.15 ms`) + Multi-Axis Log-Bayes `E_perp` & Pivot Ranking (`0.75 ms`) + Shortlist-Only (`<= 24`) 3-Way Halo SW / Piecewise Polarity SW / Steiner Trace (`1.55 ms`) + Submodular Diversifier & Single-Channel Serialization (`0.45 ms`) = **`p50 ~ 2.2 ms`, `p95 ~ 3.9 ms`, max `< 6.5 ms`** (clearing both `< 5 ms` target and `10 ms` Free-Tier limit).

---

## 6. Reimagined MCP v3 Discovery Environment

### 6.1 Progressive Disclosure, Schema Hygiene & Non-Stub Defaults

1. **Three-View Progressive Envelope (`view: "clues" | "evidence" | "full"`, default `"clues"`):**
   - `"clues"` (`2–6 KB` default): Original-language texts (`MT`/`NA28` + concise `WEB`), condensed `structural_outline` (zero `deviant_cells`), automatic `lxx_shifts[]`, verified `wordplays[]`, top submodularly diversified `connections[]` (tagged with `bits`, `epistemic_register`, `independent_axes`), `pivot_clues[]`, and compact `expand_id` handles (`ev:...`, `3way:...`, `lit:...`).
   - `"evidence"` (`6–14 KB`): Hydrates token-level 3-way attribution, clause-by-clause sequence alignment, or Steiner multi-hop proof trails for selected items or `expand_id`s.
   - `"full"`: Complete payload for Website UI rendering.
2. **Consistent Field Names & Single-Channel Transport:** Remove duplicate `structuredContent` from `jsonReply` (`-50%` wire bytes); normalize `.connections[]` across `get_Passage`, `get_Word`, and `get_Connection`; make `follow_connectionchain` emit string `next_id` handles valid directly as `next`.
3. **Vowel-Aware & Zero-Stub Word Lookup:** Respect Hebrew niqqud (`בֹּר` -> `H1253` potash `#1` over Aramaic `H1247`; `שַׁיִת Isa 5:6` -> `H7898`), and when passed any Strong's ID (`H0068`, `H6697`, `H0391`, `G3682`), **always** return the sanitized primary lexical entry with full `connections[]`, `etymology`, and bidirectional `lxx_profile`, relegating true polysemous alternatives to `other_senses[]`.

### 6.2 Composable 6+1 Tool Interface

1. **`get_Passage({ passage, view="clues", focus_axes?, include_lxx_shifts=true, offset=0, limit=30 })`**: `Judges 19` drops from **`704 KB` -> `~7.5 KB`**, automatically surfacing `Genesis 19`, `Genesis 18:5`, and `1 Samuel 11:7` via multi-axis convergence.
2. **`get_Word({ word, passage?, view="clues", connections=10, include_physical=true })`**: Contextualizes sense via `P(s | w, v)`, exposes bidirectional LXX mappings (`G0204 -> H6438 Isa 28:16`; `H5509 -> G0096 ἀδόκιμος`), transparent compound etymologies, sense-gated physical mechanisms, and non-empty `connections[]`.
3. **`get_Connection({ items [2..6], view="clues", connections=10, mode="converge"|"contrast" })`**: Computes `E_perp(A, B)`, Conductance Steiner subgraph (`all_endpoints_connected`), Bridge Pivots `pivot_clues[]`, and automatic `tri_textual_diff` / `SW^piece_pol` checks across items.
4. **`follow_connectionchain({ chain?, next?, action="follow"|"branch"|"revisit"|"inspect"|"expand", focus_axes?, limit=8 })`**: Tracks `focus_axes` along the trail and suppresses off-axis hubs (`שָׁכַם`, `יָטַב`, `זָהָב`), exposing bridge pivots and `contrast` branches.
5. **`research({ query?, operations [1..8], view="clues" })`**: Retains existing ops (`set_combine` accelerated to `< 10 us` via `3,904`-byte bitsets!) and adds **5 flagship capabilities**:
   - **`lxx_concordance`**: Direct full-Rahlfs Septuagint lemma/stem/phrase concordance + MT Strong's translation profile (`find every LXX occurrence of ἀδόκιμος or ἠμέλησα`).
   - **`tri_textual_diff`**: Simultaneous `MT <-> LXX <-> NT` Halo Smith–Waterman attribution (supports standalone NT passage auto-discovery—e.g. `Matt 4:1-11` auto-resolving `Deut 8:3; 6:16; 6:13; Ps 91:11-12`—or explicit comparisons).
   - **`clause_role_query`**: Corpus-wide MACULA clause search by `(predicate, agent, patient, instrument, location, polarity, expand_concept=true)`.
   - **`sequence_parallels`**: Discovery/comparison of ordered type-scenes and polarity/order reversals via `SW^piece_pol` (`Gen 1 <-> Jer 4:23-26`, `Judg 19 <-> Gen 19`, `Deut 8:2-3 <-> Matt 4:1-4`).
   - **`wordplay_scan`**: Query precomputed Morpheme-Stem + Talion + `±10v` Onomastic/Valence wordplay across books/sections.
6. **`get_prompt({})` & `write_Note({...})`**: `get_prompt` guides callers to start in `view: "clues"`, combine `tri_textual_diff` + `clause_role_query` + `set_combine`, and escalate to `view: "evidence"` only for finalists.

### 6.3 Representative Discovery Workflow (`M2` + `M6` Unified in 2 Calls, `< 9 KB` Total)

- **Call 1 (`~5.5 KB`):** `research({ view: "clues", operations: [{ id: "tri", op: "tri_textual_diff", passage: "1 Peter 2:4-8" }, { id: "role", op: "clause_role_query", predicate: "H7760", patient: "H0068", expand_concept: true }] })`
  - `tri` detects **three spliced OT quotes** (`Isa 28:16` + `Ps 118:22` + `Isa 8:14`), flags `ἀκρογωνιαῖον ... οὐ μὴ καταισχυνθῇ` as `agrees_lxx_against_mt` (`חוּשׁ -> καταισχύνω`), flags `πέτρα σκανδάλου` as `agrees_mt_against_lxx` (MT `צוּר מִכְשׁוֹל` vs LXX `πέτρας πτώματι`), and flags Halo adaptation `Ἰδοὺ τίθημι` (`G5087`, shared with `Rom 9:33` against LXX `ἐμβαλῶ`).
  - `role` surfaces `Gen 28:18, 22` (Jacob setting [`שׂוּם`] the stone [`אֶבֶן`] as a pillar -> `בית־אלהים`) alongside `Isa 28:16` (`τίθημι λίθον`).
- **Call 2 (`~3.4 KB`):** `get_Connection({ items: ["Genesis 28:18-22", "Isaiah 8:14", "Isaiah 28:16", "1 Peter 2:4-8"], view: "evidence" })`
  - Returns a `16.4-bit` (`p_null < 2e-5`) 4-axis converged Steiner proof path highlighting `Isa 8:14` as the sole OT convergence of `אֶבֶן + צוּר + מִקְדָּשׁ` (`PivotScore #1`), zero `שָׁכַם` noise.

---

## 7. Synthesis of Delegated Empirical Evidence (`M1`–`M6`, `I1`–`I2`, `E1`–`E4`)

- **Blind Live MCP (`M1`–`M6`):** `M1` proved `Isa 5:6-7` and `Mic 1:10-15` paronomasia worked while `Matt 16:18`, `1 Cor 3:17`, `Phlm 1:10 <-> 20`, and `Mic 1:11` failed amidst `-μος/-ιος/-ρον` noise; `M2` reconstructed `Hab 2:4`, `Isa 28:16 + 8:14`, and `Isa 40:3-5` manually despite `2x` wire bloat, `lxx(alignments)` mismatches (`πιστεύων -> מוּסָד`), and missing `NT <-> LXX` tools; `M3` traced metallurgical refining (`H1253`, `H5509`, `Ezek 22` role frame, `צָרַף+בָּחַן` 5v) while hitting `בֹּר -> H1247`, missing `סיג <-> ἀδόκιμος`, and clipped `G1381`; `M4` saw `Amos 1-2` and `Gen 1` unit deviations work alongside `888 KB` dumps, `compare_patterns` failure on `Gen 1 vs Jer 4:23-26`, false Edom chiasm, `H7725` idiom reordering, and `Ps 136:1` evaluation false positive; `M5` proved `Judg 19` fuses `Gen 18:5` (`סָעַד+לֵב`) and `Gen 19`, while `compare_patterns` scored `0` on roles; `M6` hit `trace_evidence` dead ends (`Exod 17:6 -> John 7:38`, `Gen 28:18 -> 1 Pet 2:5`), `H6697` rock/rocks pseudo-homograph warnings, and `704 KB` chapter dumps.
- **Telemetry (`I1`–`I2`):** Audited `20,000 / 20,000` staging-bundle ceiling (`15,850` obsolete R8/R9b shards), `base64-gz` nested decode bottlenecks, `hebrew_lxx_word_alignments` = `9` rows (`2.6 KB`), locally unpacked `oewn-2025` (`72.4 MB` CC BY 4.0), `lxx_swete_words` (`CC BY-SA 4.0`), and `2x` `jsonReply` wire serialization.
- **Prototype Benchmarks (`E1`–`E4`):**
  - `E1`: Full 5-partition CSR = `10.73 MB`; Typed Conductance Push (`beta=0.35-0.50`) recovered `Gen 28:18 <-> 1 Pet 2:5-6` (`#1 G3037, #2 H0068, #3 G5087, #5 H7760`) & `Mal 3 <-> 1 Pet 1:7` (`#1 H6884, #2 H2212, #3 Prov 17:3`), isolated `H2050` prefix pollution, and motivated offline precomputed PPR + `N_eff` axis damping against `NEG6`.
  - `E2`: Morpho-syntactic `MT <-> LXX` + 3-Way Halo SW hit **`38/38 (100%)`** witness token accuracy, **`2/2 (100%)`** composite splice detection (`Rom 9:33`, `1 Pet 2:6-8`), **`2/2 (100%)`** negative rejection, fixed `πιστεύων -> הַמַּאֲמִין`, `ἀκρογωνιαῖον -> פִּנַּת`, `סִיג -> ἀδόκιμος`, `Hab 2:4` `3ms -> 1cs`, `Isa 40:5` `+σωτήριον`, and identified `TVTMS:` Jeremiah transposition keying.
  - `E3`: Residual SSM `S_tilde` + Refrain-Pinned Permutations scored **`0/3 (0%)` FPs** (`Amos 1:3-2:5 p=1.000`, `Ps 136 p=0.786-0.980`, `Gen 5 p=0.751-1.000`) and **`4/4 (100%)` true chiasms** (`Gen 9:6 p=0.005`, `Isa 6:10 p=0.010`, `Gen 1:27 p=0.025`, `Amos 5:4-6 p=0.025`); Polarity SW scored `p=0.005` (`19` clauses) on `Gen 19 <-> Judg 19` and `2x` (`5.01` vs `2.45`, `p=0.020`) on `Gen 1 <-> Jer 4:23-26`, proving need for piecewise mixed-order blocks, `1:2`/`2:1` bundling, and lossless clauses.
  - `E4`: Binary hybrid bitset/BMW index = **`828.3 KiB` gz (`127x` smaller)**, **`p50 = 15.0 us` (`508x` faster)**, `max = 0.37 ms`, `50.9%` block skip, `100%` Top-32 score parity; `82.6%` pseudo-homograph scan (`1,539` inflection + `361` proper-name leaks, `74` hijacked headwords); LLR-margin gate analysis (`95.8%` `B1253`, `78.1%` `H7307`, `H5869` `43:1` calibration); Stem+Onomastic filter dropped FPs **`60% -> 0%`** (`7/9` recall; `Mic 1:11` valence gap diagnosed).

---

## 8. Concrete Implementation Strategy for Neon (`Stages S0–S6`)

Neon should coordinate execution across targeted subagents (Compiler/Ingestion, Edge Index/Graph, Literary/Alignment, MCP/UI) strictly validating each acceptance gate before advancing:

- **Stage `S0` — Wire Fix, License Audit & Bundle Consolidation:** Remove duplicate `structuredContent` in `jsonReply`; normalize `.connections[]` & `next_id`; retire `15,850` legacy `r8/r9b` micro-shards and `0`-caller legacy files (`literary-hebrew*.mjs`, `PassageDiscoveryStrip.ts`).
  - *Gate `G0`:* Zero R12/R13 regressions; median MCP bytes drop `>= 55%`; bundle `< 4,200` files.
- **Stage `S1` — Canonical Hygiene, Open Scriptorium `lxx-morph` & LLR Sense-Gated Ontology:** Build `sanitize-step-lexicon.mjs` (fix `74` hijacked headwords, collapse `1,539` inflections, segregate `361` proper names, purge prefix markers, add niqqud-aware ranking). Ingest CC BY 4.0 Open Scriptorium `lxx-morph` + `verse_pairs.jsonl` (clean-room TS, `canonical_verse_id` keying, Swete CC BY-SA separation), run bidirectional EM + `Psi(i,j)` aligner -> `v3/align/mt-lxx-00..31.bin`. Run LLR-Margin Sense Gate (`gamma_min = 3.0`) over `oewn-2025` + curated `Wikidata` (`2,500+` physical concepts).
  - *Gate `G1`:* `0` restricted-license provenance violations; `<= 0.14` stratified AER across `200` aligned MT↔LXX verses (incl. CATSS edge cases); `< 3%` OEWN polysemy FP rate on `H5869`/`H5158`/`H7307`/`B1253`.
- **Stage `S2` — Lossless Clauses, Morpheme/Valence Wordplay & Residual SSM+MDL Rhetoric:** Compile lossless sequential clause packs (`ConceptID`, MACULA actants, polarity), Inflection-Stem + Talion + `±10v` Onomastic/Valence wordplay index, Residual SSM `S_tilde` + Scale-Adaptive Permutation/MDL chiasms (`>= 3` root consonants), and Idiom-Atom template surprisal + PELT into `v3/rhetoric/`. Byte-sync `literary-engine.ts` to `bible-mcp`.
  - *Gate `G2`:* `0%` chiasm FPs on `Amos 1-2`, `Ps 136`, `Gen 5`, `Num 7`; `100%` on `Gen 9:6`, `Isa 6:10`, `Gen 1:27`, `Amos 5:4-6`; `0%` suffix wordplay FPs with recovery of `Matt 16:18`, `1 Cor 3:17`, `Phlm 1:10-20`, `Mic 1:10-15`.
- **Stage `S3` — Binary Hybrid Bitset/BMW Index & Precomputed Conductance PPR:** Build `v3/index/postings-bmw.bin.gz` (HB+NT+Rahlfs+Concept+Actant), flat `v3/profiles/` & `v3/verses/` packs (no `base64-gz`), and `v3/graph/ppr-top64.pack` + `typed-csr.bin.gz` (`beta = 0.40, kappa = 3`).
  - *Gate `G3`:* Total bundle `< 2,500` files, max file `< 10 MiB`; warm Worker retrieval + PPR merge `p95 < 1.0 ms`.
- **Stage `S4` — Multi-Axis Log-Bayes Scorer & Top-24 Shortlist Verifiers:** Replace `r10-discovery.ts` linear rescoring & `multihop-search.ts` with `E_perp(A, B)` (`N_eff` damper), `PivotScore`, `alignTriTextualQuote` (`±3` halo + splice detector), `alignClauseSequencesPiecewise` (`1:2`/`2:1` bundling), and Conductance Steiner tracer.
  - *Gate `G4`:* Full Worker RPC `p50 < 3.0 ms`, `p95 < 5.0 ms`, `p99 < 8.5 ms` (`0` HTTP `1102`s); `100%` negative rejection (`NEG1`–`NEG8`); full recovery across `Gen 28:18 <-> 1 Pet 2:5-6`, `Exod 17:6 <-> John 7:37-38`, `Gen 1 <-> Jer 4:23-26`, `Judg 19 <-> Gen 18-19`, `Deut 8:2-3 <-> Matt 4:1-4`, and `Rom 9:33 / 1 Pet 2:6-8`.
- **Stage `S5` — MCP v3 Contracts, Progressive Views & UI Integration:** Ship `view: "clues" | "evidence" | "full"`, zero-stub `get_Word`, axis-guided `follow_connectionchain`, the 5 new `research` operations (`lxx_concordance`, `tri_textual_diff`, `clause_role_query`, `sequence_parallels`, `wordplay_scan`), updated `get_prompt`, and matching Website UI cards (`PassageComparison.ts`, `DiscoverConnections.ts`, `PatternBoard.ts`, `DiscoveryGraph.ts`).
  - *Gate `G5`:* `check:types` + `vite build` + parity tests pass; `M1`–`M6` failure cases solved in `<= 3` calls at `< 8 KB` per `"clues"` packet.
- **Stage `S6` — Held-Out Evaluation, Null/FDR Calibration & Safe Canary Deployment:** Run `R13` + `H1`–`H3` + unseen `v3` multi-book holdouts + `50` adversarial hub/strophic/homograph controls + fresh independent blind MCP sessions prior to live rollout (keeping rollback version IDs).

---

## 9. Unresolved Theoretical Questions Requiring Stage Benchmarks

1. **Axis Granularity & Partial Correlation (`E_perp`):** Determine during `S4` whether OEWN L1 co-hyponym materials (e.g., `silver/gold/bronze`, `cedar/cypress`) should merge into one semantic axis or receive soft Mahalanobis/DPP correlation penalties (`r_ab in (0, 1)`) so Solomon-temple inventory lists do not inflate axis perplexity `N_eff`.
2. **Translator-Group Literalness Priors (`sigma_book`):** Fit empirical `sigma_book` spreads and unmatched-clause thresholds per Septuagint translation unit in `S1` (e.g., Pentateuch vs. freer paraphrastic Greek in Job, Proverbs, Old Greek Daniel, and Isaiah).
3. **Long-Term Swete Witness Provenance:** Decide in `S1` whether Swete diplomatic differences (`CC BY-SA 4.0`) remain separated or are eventually regenerated from public-domain Swete page images under `CC0` for pure `CC BY 4.0 / CC0` end-to-end purity.
4. **Architectural Spatial-Proportion Verifier:** Evaluate after `S5` blind testing on sanctuary typology (`Tabernacle -> 1 Kgs 6-7 -> Ezek 40-48 -> Rev 11, 21-22`) whether an explicit cubit/reed spatial-ratio graph adds measurable discovery value beyond `sacred_architecture` + `sequence_parallels`.
