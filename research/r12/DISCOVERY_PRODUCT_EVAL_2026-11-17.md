# BibleResearch R11 discovery product evaluation — live MCP, 2026-11-17

**Question:** Does the currently connected BibleResearch already discover surprising and *true* biblical word/passage relationships without hand-authored targets?

**Tested:** Existing connected \`discover_biblical_connections_v1\` release \`r11-v1.0\`, \`discover_relationship_paths_v1\` relationship release \`r9b-v1.0\`, \`get_connection_evidence_v1\`, \`prompt_verse_words\`, \`resolve_research_concept_v1\`, \`inspect_word_formation\`, \`get_word_relationships_v2\`. Read-only requests. **Not** an R12-01 UI preview or deployed newer GitHub branch. This evaluation is deliberately different from the correctness QA in [CHATGPT_LIVE_QA_2026-11-17.md](CHATGPT_LIVE_QA_2026-11-17.md).

## Bottom line

**Useful as an evidence and *candidate lead* explorer; not yet an autonomous, reliably ranked hidden-connection engine.** It independently groups real cross-book occurrences and can trace 1–3 typed graph edges. However, direct semantic interpretation, proper-name disambiguation, independent multipath proofs, novel structural parallels and the ordering of genuinely relevant finds are not yet dependable. Do not treat a score/tier as proof of an intended connection.

## Positive examples, with exact evidence

### A. Scarlet material connects Tamar's birth narrative, Rahab's deliverance, and tabernacle materials

Unprompted \`discover_biblical_connections_v1({query:"scarlet",limit:25})\` found **rank 20** \`r11:cluster:H8144:historical_narrative\`. Evidence tool reports \`derivation_method=evidence_derived_semantic_cluster\`, source \`H8144\` in **Genesis 38:28, Genesis 38:30, Joshua 2:21**, actual Hebrew surface shani. It also showed Exodus 25:4 in its temple/materials cluster. Independent \`prompt_verse_words\` verified H8144 for Genesis 38:28, Joshua 2:21 and Exodus 25:4.

This cross-book repeated object is a **real and potentially surprising discovery**. But R11 did **not** explain the narrative parallel or connect Tamar and Rahab as participants in Matthew 1:3–5; that additional line of inquiry needs a separate person/genealogy/entity graph. It should be suggested as a *question*, not claimed as intent.

### B. Joshua 2:18 scarlet → cord → thread has a concrete 2-hop witness

\`discover_relationship_paths_v1({source:"lemma:H8144",target:"lemma:H2339",max_hops:2})\` returned **19 total** evidence paths, exhaustive within the tested graph settings; strongest direct grammatical edge has source witness **JOS 2:18** \`rel:macula-hebrew-wlc:JOS 2:18#cl2:possessive_construction_with:o060020180082:o060020180071\`. Another 2-step path goes H8144 (shani) → **H8615A** (*tiqvah*, cord) → H2339 (*chut*, thread), supported by JOS 2:18.

\`prompt_verse_words({p_book:6,p_chapter:2,p_verse:18})\` confirms consecutive Hebrew H8615 (position 6), H2339 (position 7), H8144 (position 8). \`resolve_research_concept_v1({query:"H8615"})\` correctly distinguishes **lemma:H8615A "cord"** and **lemma:H8615B "hope"**, identically written תִּקְוָה. However, \`discover_relationship_paths_v1({source:"lemma:H8615A",target:"lemma:H8615B",max_hops:2,layers:["lexical","grammatical"]})\` returned **no_supported_path** (exhaustive in those layers); \`inspect_word_formation({p_query:"H8615"})\` found no documented common root, so a "cord of hope" connection is an **unverified literary/orthographic hypothesis**, not proved derivation or authorial intent. A productive system should surface the **candidate** without asserting it.

### C. Actual Greek seed → word in Luke 8:11

\`discover_relationship_paths_v1({source:"lemma:G4703",target:"lemma:G3056",max_hops:2})\` returned a direct \`collocates_in_clause\` witness **LUK 8:11**. The STEP verse reader confirmed Greek σπόρος (G4703) and λόγος (G3056) in the verse, which explicitly explains that the seed is God's word. This is *true source evidence* but the path engine labels it statistical collocation rather than extracting the actual **explicit metaphor/identification**. It then presents weaker 2-hop paths through common function words, e.g. G1510 (*to be*), G1909 (*upon*); up to 71 paths in a 3-hop run, with incomplete coverage/limits. **Number of paths is not number of independent meaningful discoveries.**

### D. Creation breath and Flood breath

\`discover_biblical_connections_v1({query:"breath",limit:12})\` retrieved H5397 נְשָׁמָה (*neshamah*) and H7307 רוּחַ (*ruach*) in one grammatical relationship. Independent STEP tokens: **Genesis 2:7** includes H5397; **Genesis 7:22** includes both H5397 and H7307 (consecutive words). That supports exploring life-giving creation and life's destruction in the Flood. The *narrative analogy* is an interpretive lead supplied by the human reader, not inferred by this R11 system.

### E. Lamps/eyes/Spirit, grounded but existing indexed R10 facts

\`discover_biblical_connections_v1({query:"lamp",limit:12})\` retrieved explicit **Revelation 4:5** lamps = seven Spirits and **Revelation 1:20** seven lampstands = churches as an important negative control. \`r10:xlang:menorah_luchnia\` linked Hebrew H4501 to Greek G3087 with source verses **Exodus 25:31, Zechariah 4:2, Revelation 11:4, Revelation 1:12**. It is real and useful, but an already indexed R10 record is **not proof R11 can autonomously infer such a pathway on new material**.

### F. Eye/spring lexical sense separation

The \`r10:homograph:ayin_eye_vs_spring_h5869\` evidence distinguishes Hebrew H5869 "eye" in **Zechariah 4:10** from "spring" in **Genesis 24:13 / Exodus 15:27**, with original Hebrew word highlights. Source-backed linguistic comparison is strong. **The different meanings must never be treated as the same referenced object.**

## What current discovery *did not* accomplish or misrepresented

### 1. Natural-language names failed even when a genealogy was mentioned

\`discover_biblical_connections_v1({query:"scarlet Tamar Rahab Matthew 1",limit:8})\` parsed "Tamar" as **lemma:H8558, palm tree**, and "Rahab" as **lemma:H7294, chaos/sea-monster Rahab**. It mapped the reference "Matthew 1" to the chapter's **verse 1**, not a genealogy scan of verses 3–5. It ranked palm-tree imagery and sea-monster passages over a narrative connection between Genesis 38, Joshua 2 and Matthew 1.

Yet standalone \`resolve_research_concept_v1({query:"Tamar"})\` correctly returns **needs_disambiguation** among H8558 (palm) and H8559* (name). Standalone Rahab resolution includes **H7343 (woman)**, G4477 (woman in Matthew 1) and H7294 (monster). When specifically queried \`"H8144 H8559G H7343 Matthew 1"\`, the engine found a simple **Genesis 38:28 vs 38:24 pericope proximity**, but did **not** assemble the Tamar–Rahab–genealogy triangle. **Critical missing feature: context-sensitive proper-name sense resolution, person identity across editions and genealogical paths.**

### 2. "Well" query's #1 recommendation was unrelated to a water well

\`discover_biblical_connections_v1({query:"well",limit:25})\` ranked **Revelation 5:6 Lamb's seven eyes/Spirits** first, apparently because the Hebrew noun H5869 can mean either eye or spring. The verse is legitimate *eye* evidence, not relevant proof about a literal *water well*. The same query includes "well" as Greek adverb καλῶς (G2573) and other English-homonym matches. Correct homograph candidates exist, but **sense-specific filtering and thematic relevance are not protecting ranking**. The query also retrieved a suspicious LXX candidate H0875 "well" → a Greek entry glossed "to celebrate in song as well"; check this source correspondence before displaying it as a real bilingual well noun match.

### 3. Relationship source witnesses are sometimes irrelevant to the claim

\`r11:gram:G3037:modifies:G5093\` says Greek "stone modified by precious", but \`get_connection_evidence_v1\` shows *Matthew 3:9, 4:3, 4:6* as its initial proof sample; the original tokens in those samples highlight G3037 stone but **not G5093 precious**. Independent \`get_word_relationships_v2({query:"G3037",relation_types:["modifies"]})\` confirms the correct grammatical source example **1 Corinthians 3:12**, so the *edge is real* but the R11 discovery evidence display selects the wrong passage samples. Source-accurate witness sets must be attached at relation level rather than generic lemma-first verses.

Similar sampling mismatch: H5397/H7307 is a real phrase in Gen 7:22 but showing Gen 2:7 or Josh 10:40 as if both terms are attested together is misleading. Already logged contextual scope-witness failure in the separate QA file.

### 4. No true semantically discriminated 3–5-hop novel proof

The deployed \`discover_relationship_paths_v1\` caps \`max_hops\` at **3**. A tested seed→word 3-hop search found 71 paths with truncated coverage, dominated by common grammatical/contextual hubs. Tested eye→well with 3 hops returned 159 possible paths under incomplete coverage. Raw path count says little about genuine multi-passage significance. No reliable example in these tests established an **unprompted, new, source-witnessed 4–5 semantic-hop cross-book discovery**. The local/offline R12 research modules should not be counted as live features.

### 5. Known evidence correctness defects remain

QA-01–QA-12 in the separate QA report document exact STEP/MACULA word_id mismatches, repeated same-lemma pseudo-cooccurrence, incorrectly promoted sense links, misleading contextual witnesses, Swete chapter-heading token contamination and intermittent HTTP 503. These make independently checking discoveries mandatory.

## Product decision

The current system is **more than a Bible search or cross-reference list**: its R11 corpus clusters (e.g., shani in Genesis 38 + Joshua 2) and R9C typed graph (scarlet→cord→thread) are real, and have source witnesses. It is not yet a generally autonomous "surprising, true, new biblical connections" curator. Use it for **auditable leads**, with independent original-script passage checking. Do not claim theological or authorial significance from matching terms alone.

**Next high-leverage work:** (1) correct source occurrence identity and proof witness selection; (2) sense-aware names/English-ambiguous terms and disambiguation; (3) independent passage-level motif patterns and genuine event/role/physical links; (4) graph proof paths with rare typed relationships, function-word suppression, multiple independent source witnesses and clear speculative status; (5) evaluate novelty, correctness and usefulness on *unseen, unbiased anchor sets*, not just handcrafted favorite motifs. Test and push a version-qualified staging MCP so ChatGPT can rerun all these cases after every fix.

**Reproduction queries:** "scarlet", "well", "seed", "lamp", "breath", "scarlet Tamar Rahab Matthew 1", "H8144 H8559G H7343 Matthew 1"; inspect exact evidence IDs above via \`get_connection_evidence_v1\`, matching STEP original tokens and R9C path witnesses.
